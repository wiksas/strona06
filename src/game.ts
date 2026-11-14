import { T_POSITION } from './court/dimensions';
import type { Outfit } from './court/figure';
import type { CourtView } from './court/scene';
import { DIFFICULTIES, cpuDecide, cpuPickBox, type Difficulty } from './engine/ai';
import { SAMPLE_DT, sampleAt } from './engine/physics';
import { XP, addXp, xpToNext } from './engine/progress';
import { CLEAR_TIME, blocking, clearDuration, clearSpot, type Blocking } from './engine/clearance';
import { REACTION, checkShot, positionAt, type Intercept, type Move, type Vec2 } from './engine/rally';
import { awardRally, newMatch, other, startNextGame, type Box, type MatchState, type Side } from './engine/rules';
import { accuracy, flightFor, pressureFactor, type ShotInput } from './engine/shots';
import { RALLY_SHOTS, SERVE_SHOTS, SHOT_LABEL, presetShot, type ShotKind } from './engine/tactics';
import { playShot, receiveStand, serveContact, serveStand, type ShotOutcome, type Striker } from './engine/turn';
import { CPU_OUTFIT, saveProfiles, type Profile } from './profiles';

type Phase = 'idle' | 'box' | 'aim' | 'move' | 'clear' | 'cpu' | 'anim' | 'point';

/** Rally paused because the previous striker stands in the way of the player about to hit. */
interface PendingClear {
  o: ShotOutcome;
  ic: Intercept;
  side: Side;
  from: Vec2;
  block: Blocking;
}
export type Mode = 'cpu' | 'hotseat';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const still = (p: Vec2): Move => ({ from: p, to: p, delay: 0 });
const SIDES: Side[] = ['p1', 'p2'];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function pressureLabel(p: number): string {
  if (p < 0.25) return 'ustawiony, pełna kontrola';
  if (p < 0.6) return 'pod presją, rozrzut większy';
  return 'rozciągnięty, rozrzut duży';
}

export class Game {
  private phase: Phase = 'idle';
  private mode: Mode = 'cpu';
  private match: MatchState | null = null;
  private difficulty: Difficulty = DIFFICULTIES[1];
  private striker: Striker | null = null;
  private receiverMove: Move = still(T_POSITION);
  private serveBox: Box | undefined;
  private shot: ShotInput | null = null;
  private shotKind: ShotKind | null = null;
  private moveTo: Vec2 = { ...T_POSITION };
  private pending: PendingClear | null = null;
  private rand = Math.random;
  private controls = $('controls');

  constructor(
    private view: CourtView,
    private profiles: Record<Side, Profile>,
    private storageOk: boolean,
  ) {
    view.onTap((x, y) => this.tap(x, y));
    view.renderer.domElement.addEventListener('keydown', (e) => this.key(e));
    view.setPlayer('p1', receiveStand('right'), null, 0);
    view.setPlayer('p2', serveStand('right'), null, 0);
    view.setBall(null);
    this.applyProfiles();
  }

  /** Called after the player menu saves new names or outfits. */
  setProfiles(profiles: Record<Side, Profile>): void {
    this.profiles = profiles;
    this.storageOk = saveProfiles(profiles) && this.storageOk;
    this.applyProfiles();
  }

  private applyProfiles(): void {
    for (const side of SIDES) this.view.setOutfit(side, this.outfitOf(side));
    this.renderBoard();
    this.renderLevel(this.striker && this.isHuman(this.striker.side) ? this.striker.side : 'p1');
  }

  start(mode: Mode, gamesToWin: number, difficultyId: string): void {
    this.view.setFrameHandler(null);
    this.pending = null;
    this.view.showZone(null);
    this.view.showMove(null);
    this.mode = mode;
    this.difficulty = DIFFICULTIES.find((d) => d.id === difficultyId) ?? DIFFICULTIES[1];
    const first: Side = this.rand() < 0.5 ? 'p1' : 'p2';
    this.match = newMatch(gamesToWin, first);
    this.applyProfiles();
    this.clearLog();
    this.log(`Losowanie rakietą: zaczyna serwis ${this.nameOf(first)}.`);
    this.beginRally();
  }

  private isHuman(side: Side): boolean {
    return side === 'p1' || this.mode === 'hotseat';
  }

  private nameOf(side: Side): string {
    return this.isHuman(side) ? this.profiles[side].name : 'CPU';
  }

  private outfitOf(side: Side): Outfit {
    return this.isHuman(side) ? this.profiles[side].outfit : CPU_OUTFIT;
  }

  private levelOf(side: Side): number {
    return this.isHuman(side) ? this.profiles[side].progress.level : this.difficulty.level;
  }

  /** Marks whose decision it is: 3D marker, scoreboard ball icon and the panel chip. */
  private setTurn(side: Side | null): void {
    this.view.setActive(side);
    for (const s of SIDES) document.querySelector(`.board-side[data-side="${s}"]`)!.toggleAttribute('data-turn', s === side);
    const chip = $('turn');
    chip.hidden = !side;
    if (side) {
      $('turn-name').textContent = this.nameOf(side);
      chip.style.setProperty('--shirt', this.outfitOf(side).shirt);
      if (this.isHuman(side)) this.renderLevel(side);
    }
  }

  private beginRally(): void {
    const m = this.match!;
    this.clearLog();
    if (m.newHand && this.isHuman(m.server)) {
      this.phase = 'box';
      this.setTurn(m.server);
      this.setPhase('Wybór kwadratu', 'Wybierz kwadrat serwisowy. Serwujesz po przekątnej, w przeciwną tylną ćwiartkę.');
      this.renderControls();
      return;
    }
    if (m.newHand) {
      m.box = cpuPickBox(this.rand);
      this.log(`CPU serwuje z ${m.box === 'left' ? 'lewego' : 'prawego'} kwadratu.`);
    }
    this.setupServe();
  }

  private setupServe(): void {
    const m = this.match!;
    const box = m.box;
    this.striker = { side: m.server, contact: serveContact(box), stand: serveStand(box), level: this.levelOf(m.server), pressure: 0 };
    this.receiverMove = still(receiveStand(box));
    this.serveBox = box;
    this.view.showZone(null);
    this.view.setPlayer(m.server, this.striker.stand, null, 0);
    this.view.setPlayer(other(m.server), this.receiverMove.from, null, 0);
    this.view.setBall(this.striker.contact);
    this.renderBoard();
    this.nextDecision();
  }

  private nextDecision(): void {
    const side = this.striker!.side;
    this.setTurn(side);
    if (this.isHuman(side)) this.enterAim();
    else this.cpuTurn();
  }

  private enterAim(): void {
    const s = this.striker!;
    this.phase = 'aim';
    this.shotKind = this.serveBox ? 'serveLob' : 'drive';
    this.shot = presetShot(this.shotKind, s.stand);
    this.moveTo = { ...T_POSITION };
    const serve = this.serveBox ? 'Serwis: celuj między linią serwisową a linią autu. ' : '';
    this.setPhase(
      this.serveBox ? 'Serwis: gdzie na ścianę?' : 'Uderzenie: gdzie na ścianę?',
      `${serve}Wybierz zagranie albo stuknij ścianę${this.serveBox ? ' frontową' : ', także boczną (boast)'}. Przeciąganie obraca kort.`,
    );
    this.renderControls();
    this.preview();
  }

  private enterMove(): void {
    this.phase = 'move';
    this.setPhase('Gdzie wracasz po uderzeniu?', 'Stuknij podłogę kortu. Z T najbliżej do każdego rogu, ale stań z dala od toru piłki, inaczej grozi stroke.');
    this.view.showMove(this.moveTo, this.outfitOf(this.striker!.side).shirt);
    this.renderControls();
  }

  private preview(): void {
    const s = this.striker!;
    const f = flightFor(s.contact, this.shot!);
    const spread = accuracy(s.level).aim * pressureFactor(s.pressure);
    this.view.showAim(this.shot!.target, spread);
    this.view.showPath(f.samples.filter((_, i) => i % 2 === 0));
    const fault = checkShot(f, this.serveBox).fault;
    const warn = document.getElementById('aim-warning');
    if (warn) {
      warn.textContent = fault ? 'Ten tor bez rozrzutu kończy się błędem. Zmień punkt lub siłę.' : '';
      warn.hidden = !fault;
    }
    const sp = document.getElementById('spread');
    if (sp) sp.textContent = `±${Math.round(spread * 100)} cm`;
  }

  private execute(): void {
    const s = this.striker!;
    this.log(`${this.nameOf(s.side)}: ${this.shotKind ? SHOT_LABEL[this.shotKind] : 'własny punkt na ścianie'}.`);
    const o = playShot({ striker: s, shot: this.shot!, moveTo: this.moveTo, receiver: this.receiverMove, serveBox: this.serveBox, rand: this.rand });
    this.animate(o);
  }

  private cpuTurn(): void {
    this.phase = 'cpu';
    this.setPhase('Uderza CPU', 'Obserwuj, gdzie stoi rywal i dokąd wraca po zagraniu.');
    this.renderControls();
    const delay = reducedMotion.matches ? 150 : 550;
    window.setTimeout(() => {
      if (this.phase !== 'cpu') return;
      const s = this.striker!;
      const d = cpuDecide({ striker: s, opponent: this.receiverMove, difficulty: this.difficulty, serveBox: this.serveBox, rand: this.rand });
      this.log(`CPU: ${SHOT_LABEL[d.kind]}.`);
      this.animate(playShot({ striker: s, shot: d.shot, moveTo: d.moveTo, receiver: this.receiverMove, serveBox: this.serveBox, rand: this.rand }));
    }, delay);
  }

  /** Plays the shot back in real time; ball flight is the information the player reads. */
  private animate(o: ShotOutcome): void {
    this.phase = 'anim';
    this.setTurn(null);
    this.view.showAim(null, 0);
    this.view.showMove(null);
    this.view.showPath(null);
    this.view.swing(o.striker);
    this.renderControls();
    const receiver = other(o.striker);
    const speed = reducedMotion.matches ? 3 : 1;
    const start = performance.now();
    let prev = 0;
    this.view.setFrameHandler((now) => {
      const t = Math.min(((now - start) / 1000) * speed, o.duration);
      const dt = t - prev;
      prev = t;
      const ball = sampleAt(o.flight, Math.min(t, o.flight.end - SAMPLE_DT));
      this.view.setBall(ball);
      this.view.setPlayer(o.striker, positionAt(o.strikerMove, t), ball, dt);
      this.view.setPlayer(receiver, t < REACTION ? positionAt(o.receiverDrift, t) : positionAt(o.receiverMove, t), ball, dt);
      if (t >= o.duration) {
        this.view.setFrameHandler(null);
        this.resolve(o);
      }
    });
  }

  private resolve(o: ShotOutcome): void {
    const r = o.result;
    if (r.kind === 'continue') {
      const ic = r.intercept;
      const from = positionAt(o.strikerMove, ic.t);
      const block = blocking(from, ic);
      if (!block) {
        this.continueRally(o, ic, { from, to: o.strikerMove.to, delay: 0 });
        return;
      }
      this.pending = { o, ic, side: o.striker, from, block };
      if (this.isHuman(o.striker)) this.enterClear();
      else this.cpuClear();
      return;
    }
    if (r.kind === 'let') this.showLet(r.reason);
    else this.finishRally(r.winner, r.reason, o.striker === r.winner && r.reason.startsWith('Rywal nie dobiegł'));
  }

  private continueRally(o: ShotOutcome, ic: Intercept, prevStrikerMove: Move): void {
    const side = other(o.striker);
    this.receiverMove = prevStrikerMove;
    this.striker = { side, contact: ic.ball, stand: ic.stand, level: this.levelOf(side), pressure: ic.pressure };
    this.serveBox = undefined;
    if (this.isHuman(side)) this.log(`${this.nameOf(side)} dobiega: ${pressureLabel(ic.pressure)}.`);
    this.nextDecision();
  }

  private enterClear(): void {
    const p = this.pending!;
    const opp = this.nameOf(other(p.side));
    this.phase = 'clear';
    this.setTurn(p.side);
    this.moveTo = clearSpot(p.from, p.ic);
    this.view.showZone(p.ic.stand, p.ic.ball);
    this.view.showMove(this.moveTo, this.outfitOf(p.side).shirt);
    const why = p.block === 'swing'
      ? `${opp} dobiegł do piłki, a Ty stoisz w polu jego zamachu.`
      : `Zasłaniasz rywalowi (${opp}) prostą linię od piłki do ściany frontowej.`;
    this.setPhase('Zejdź z drogi rywalowi', `${why} Stuknij podłogę poza czerwoną strefą. Krótkie zejście: gra toczy się dalej. Za długie: let. Zostanie: stroke dla rywala.`);
    this.renderControls();
    this.syncClearButton();
  }

  private syncClearButton(): void {
    const p = this.pending!;
    const blocked = blocking(this.moveTo, p.ic);
    const late = clearDuration(p.from, this.moveTo) > CLEAR_TIME;
    const go = document.getElementById('clear-go') as HTMLButtonElement | null;
    const note = document.getElementById('clear-note');
    if (go) go.disabled = !!blocked;
    if (note) {
      note.textContent = blocked ? 'To miejsce nadal blokuje rywala.' : late ? 'Daleko: nie zdążysz przed zamachem, będzie let.' : 'Zdążysz zejść, wymiana trwa dalej.';
      note.className = blocked || late ? 'warning' : 'hint';
    }
  }

  /** The CPU clears unless it slips, which is more likely for weaker opponents. */
  private cpuClear(): void {
    const p = this.pending!;
    if (this.rand() < this.difficulty.clearFail) {
      this.pending = null;
      this.finishRally(other(p.side), 'Stroke: CPU nie zszedł z drogi', false);
      return;
    }
    this.runClear(clearSpot(p.from, p.ic));
  }

  private runClear(to: Vec2): void {
    const p = this.pending!;
    this.pending = null;
    this.phase = 'anim';
    this.setTurn(null);
    this.view.showMove(null);
    this.renderControls();
    const move: Move = { from: p.from, to, delay: REACTION };
    const duration = clearDuration(p.from, to);
    const speed = reducedMotion.matches ? 3 : 1;
    const start = performance.now();
    let prev = 0;
    this.view.setFrameHandler((now) => {
      const t = Math.min(((now - start) / 1000) * speed, duration);
      this.view.setPlayer(p.side, positionAt(move, t), p.ic.ball, t - prev);
      prev = t;
      if (t < duration) return;
      this.view.setFrameHandler(null);
      this.view.showZone(null);
      if (duration > CLEAR_TIME) {
        this.showLet(`Let: ${this.nameOf(p.side)} zszedł z drogi, ale za późno`);
      } else {
        this.log(`${this.nameOf(p.side)} schodzi z drogi.`);
        this.continueRally(p.o, p.ic, still(to));
      }
    });
  }

  private showLet(reason: string): void {
    this.phase = 'point';
    this.setTurn(null);
    this.log(reason);
    this.setPhase('Let', `${reason}. Wymiana zostanie powtórzona.`);
    this.renderControls(() => [this.button('Powtórz wymianę', () => this.setupServe(), true)]);
  }

  private finishRally(winner: Side, reason: string, outright: boolean): void {
    this.phase = 'point';
    this.setTurn(null);
    this.view.showZone(null);
    this.view.showMove(null);
    const m = awardRally(this.match!, winner);
    this.match = m;
    this.log(reason);
    if (this.isHuman(winner)) this.grantXp(winner, outright, m);
    this.renderBoard();
    if (m.matchWinner) {
      this.setPhase(`Mecz dla: ${this.nameOf(m.matchWinner)}`, `${reason}. Gemy ${m.games.p1}:${m.games.p2}.`);
      this.renderControls(() => [this.button('Zagraj kolejny mecz', () => ($('menu') as HTMLDialogElement).showModal(), true)]);
    } else if (m.gameWinner) {
      this.setPhase(`Gem dla: ${this.nameOf(m.gameWinner)} (${m.score.p1}:${m.score.p2})`, `${reason}. Gemy ${m.games.p1}:${m.games.p2}.`);
      this.renderControls(() => [this.button('Następny gem', () => {
        this.match = startNextGame(this.match!);
        this.beginRally();
      }, true)]);
    } else {
      this.setPhase(`Punkt: ${this.nameOf(winner)}`, `${reason}.`);
      this.renderControls(() => [this.button('Następna wymiana', () => this.beginRally(), true)]);
    }
  }

  /** `outright`: the winner's own shot was not reached. */
  private grantXp(side: Side, outright: boolean, m: MatchState): void {
    let xp = XP.rally;
    if (outright) xp += XP.winner;
    if (m.gameWinner === side) xp += XP.game;
    if (m.matchWinner === side) xp += XP.match;
    const { progress, levelsGained } = addXp(this.profiles[side].progress, xp);
    this.profiles[side].progress = progress;
    this.storageOk = saveProfiles(this.profiles) && this.storageOk;
    this.log(`${this.nameOf(side)} +${xp} XP${levelsGained ? `. Awans na poziom ${progress.level}: mniejszy rozrzut uderzeń.` : ''}`);
    this.renderLevel(side);
  }

  private tap(x: number, y: number): void {
    if (this.phase === 'aim') {
      const hit = this.view.pick(x, y, this.serveBox ? ['front'] : ['front', 'left', 'right']);
      if (!hit || hit.surface === 'floor') return;
      this.shot = { ...this.shot!, target: { surface: hit.surface, u: hit.surface === 'front' ? hit.p.x : hit.p.z, v: hit.p.y } };
      this.shotKind = null;
      this.syncShotButtons();
      this.preview();
    } else if (this.phase === 'move' || this.phase === 'clear') {
      const hit = this.view.pick(x, y, ['floor']);
      if (!hit) return;
      this.moveTo = { x: hit.p.x, z: hit.p.z };
      this.view.showMove(this.moveTo);
      if (this.phase === 'clear') this.syncClearButton();
    }
  }

  private key(e: KeyboardEvent): void {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (!d) return;
    if (this.phase === 'aim') {
      const t = this.shot!.target;
      this.shot = { ...this.shot!, target: { ...t, u: t.u + d[0] * 0.1, v: Math.max(0.1, t.v + d[1] * 0.1) } };
      this.shotKind = null;
      this.syncShotButtons();
      this.preview();
    } else if (this.phase === 'move' || this.phase === 'clear') {
      this.moveTo = { x: this.moveTo.x + d[0] * 0.2, z: this.moveTo.z - d[1] * 0.2 };
      this.view.showMove(this.moveTo);
      if (this.phase === 'clear') this.syncClearButton();
    } else return;
    e.preventDefault();
  }

  private button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (primary) b.className = 'primary';
    b.addEventListener('click', onClick);
    return b;
  }

  private renderControls(custom?: () => HTMLElement[]): void {
    const c = this.controls;
    c.replaceChildren();
    if (custom) {
      c.append(...custom());
      return;
    }
    if (this.phase === 'box') {
      const row = document.createElement('div');
      row.className = 'row';
      const pick = (box: Box) => {
        this.match!.box = box;
        this.setupServe();
      };
      row.append(this.button('Lewy kwadrat', () => pick('left')), this.button('Prawy kwadrat', () => pick('right')));
      c.append(row);
    } else if (this.phase === 'aim') {
      const group = document.createElement('div');
      group.className = 'shots';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', 'Zagranie');
      for (const kind of this.serveBox ? SERVE_SHOTS : RALLY_SHOTS) {
        const b = this.button(SHOT_LABEL[kind], () => {
          this.shotKind = kind;
          this.shot = presetShot(kind, this.striker!.stand);
          this.syncShotButtons();
          (document.getElementById('power') as HTMLInputElement).value = String(Math.round(this.shot.power * 100));
          this.preview();
        });
        b.dataset.kind = kind;
        group.append(b);
      }
      const power = document.createElement('label');
      power.className = 'power';
      power.innerHTML = '<span>Siła uderzenia</span><input id="power" type="range" min="0" max="100" step="1"><span class="scale"><span>miękko</span><span>mocno</span></span>';
      const input = power.querySelector('input')!;
      input.value = String(Math.round(this.shot!.power * 100));
      input.addEventListener('input', () => {
        this.shot = { ...this.shot!, power: Number(input.value) / 100 };
        this.preview();
      });
      const info = document.createElement('dl');
      info.className = 'info';
      info.innerHTML = `<div><dt>Rozrzut (2 z 3 uderzeń w kole)</dt><dd id="spread"></dd></div><div><dt>Pozycja</dt><dd>${pressureLabel(this.striker!.pressure)}</dd></div>`;
      const warn = document.createElement('p');
      warn.id = 'aim-warning';
      warn.className = 'warning';
      warn.hidden = true;
      warn.setAttribute('role', 'status');
      c.append(group, power, info, warn, this.button('Dalej: gdzie wracasz?', () => this.enterMove(), true));
      this.syncShotButtons();
    } else if (this.phase === 'clear') {
      const note = document.createElement('p');
      note.id = 'clear-note';
      note.setAttribute('role', 'status');
      const go = this.button('Zejdź tutaj', () => this.runClear(this.moveTo), true);
      go.id = 'clear-go';
      const row = document.createElement('div');
      row.className = 'row';
      row.append(
        this.button('Najbliższe wolne miejsce', () => {
          this.moveTo = clearSpot(this.pending!.from, this.pending!.ic);
          this.view.showMove(this.moveTo);
          this.syncClearButton();
        }),
        this.button('Zostań (stroke dla rywala)', () => {
          const p = this.pending!;
          this.pending = null;
          this.finishRally(other(p.side), `Stroke: ${this.nameOf(p.side)} nie zszedł z drogi`, false);
        }),
      );
      c.append(note, go, row);
    } else if (this.phase === 'move') {
      const row = document.createElement('div');
      row.className = 'row';
      row.append(
        this.button('Wróć na T', () => {
          this.moveTo = { ...T_POSITION };
          this.view.showMove(this.moveTo);
        }),
        this.button('Zostań w miejscu', () => {
          this.moveTo = { ...this.striker!.stand };
          this.view.showMove(this.moveTo);
        }),
      );
      const actions = document.createElement('div');
      actions.className = 'row';
      actions.append(this.button('Wróć do celowania', () => {
        this.view.showMove(null);
        const shot = this.shot;
        const kind = this.shotKind;
        this.enterAim();
        this.shot = shot;
        this.shotKind = kind;
        (document.getElementById('power') as HTMLInputElement).value = String(Math.round(shot!.power * 100));
        this.syncShotButtons();
        this.preview();
      }), this.button('Uderz', () => this.execute(), true));
      c.append(row, actions);
    }
  }

  private syncShotButtons(): void {
    this.controls.querySelectorAll<HTMLButtonElement>('.shots button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.kind === this.shotKind));
    });
  }

  private setPhase(title: string, hint: string): void {
    $('phase-title').textContent = title;
    $('phase-hint').textContent = hint;
  }

  private renderBoard(): void {
    for (const side of SIDES) {
      const el = document.querySelector<HTMLElement>(`.board-side[data-side="${side}"]`)!;
      el.style.setProperty('--shirt', this.outfitOf(side).shirt);
      $(`name-${side}`).textContent = this.nameOf(side);
    }
    const m = this.match;
    if (!m) return;
    for (const side of SIDES) {
      $(`score-${side}`).textContent = String(m.score[side]);
      $(`games-${side}`).textContent = String(m.games[side]);
      document.querySelector(`.board-side[data-side="${side}"]`)!.toggleAttribute('data-serving', m.server === side);
    }
    $('board').setAttribute('aria-label', `Wynik: ${this.nameOf('p1')} ${m.score.p1}, ${this.nameOf('p2')} ${m.score.p2}. Gemy ${m.games.p1}:${m.games.p2}. Serwuje: ${this.nameOf(m.server)}.`);
  }

  private renderLevel(side: Side): void {
    const { level, xp } = this.profiles[side].progress;
    const need = xpToNext(level);
    $('level-name').textContent = this.profiles[side].name;
    $('level').textContent = String(level);
    $('xp-text').textContent = `${Math.floor(xp)} / ${need} XP`;
    const bar = $('xp') as HTMLProgressElement;
    bar.max = need;
    bar.value = xp;
    $('storage-note').hidden = this.storageOk;
  }

  private log(text: string): void {
    const li = document.createElement('li');
    li.textContent = text;
    $('log').append(li);
  }

  private clearLog(): void {
    $('log').replaceChildren();
  }
}
