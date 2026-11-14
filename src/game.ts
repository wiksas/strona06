import { T_POSITION } from './court/dimensions';
import type { Outfit } from './court/figure';
import type { CourtView } from './court/scene';
import { DIFFICULTIES, cpuDecide, cpuPickBox, type Difficulty } from './engine/ai';
import { SAMPLE_DT, sampleAt } from './engine/physics';
import { XP, addXp, xpToNext } from './engine/progress';
import { REACTION, checkShot, positionAt, type Move, type Vec2 } from './engine/rally';
import { awardRally, newMatch, other, startNextGame, type Box, type MatchState, type Side } from './engine/rules';
import { accuracy, flightFor, pressureFactor, type ShotInput } from './engine/shots';
import { RALLY_SHOTS, SERVE_SHOTS, SHOT_LABEL, presetShot, type ShotKind } from './engine/tactics';
import { playShot, receiveStand, serveContact, serveStand, type ShotOutcome, type Striker } from './engine/turn';
import { CPU_OUTFIT, saveProfiles, type Profile } from './profiles';

type Phase = 'idle' | 'box' | 'aim' | 'move' | 'cpu' | 'anim' | 'point';
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
      const side = other(o.striker);
      const ic = r.intercept;
      this.receiverMove = { from: positionAt(o.strikerMove, ic.t), to: o.strikerMove.to, delay: 0 };
      this.striker = { side, contact: ic.ball, stand: ic.stand, level: this.levelOf(side), pressure: ic.pressure };
      this.serveBox = undefined;
      if (this.isHuman(side)) this.log(`${this.nameOf(side)} dobiega: ${pressureLabel(ic.pressure)}.`);
      this.nextDecision();
      return;
    }
    this.phase = 'point';
    if (r.kind === 'let') {
      this.log(r.reason);
      this.setPhase('Let', r.reason);
      this.renderControls(() => [this.button('Powtórz wymianę', () => this.setupServe(), true)]);
      return;
    }
    const m = awardRally(this.match!, r.winner);
    this.match = m;
    this.log(r.reason);
    if (this.isHuman(r.winner)) this.grantXp(r.winner, o, m);
    this.renderBoard();
    const winnerName = this.nameOf(r.winner);
    if (m.matchWinner) {
      this.setPhase(`Mecz dla: ${this.nameOf(m.matchWinner)}`, `${r.reason}. Gemy ${m.games.p1}:${m.games.p2}.`);
      this.renderControls(() => [this.button('Zagraj kolejny mecz', () => ($('menu') as HTMLDialogElement).showModal(), true)]);
    } else if (m.gameWinner) {
      this.setPhase(`Gem dla: ${this.nameOf(m.gameWinner)} (${m.score.p1}:${m.score.p2})`, `${r.reason}. Gemy ${m.games.p1}:${m.games.p2}.`);
      this.renderControls(() => [this.button('Następny gem', () => {
        this.match = startNextGame(this.match!);
        this.beginRally();
      }, true)]);
    } else {
      this.setPhase(`Punkt: ${winnerName}`, `${r.reason}.`);
      this.renderControls(() => [this.button('Następna wymiana', () => this.beginRally(), true)]);
    }
  }

  private grantXp(side: Side, o: ShotOutcome, m: MatchState): void {
    let xp = XP.rally;
    if (o.striker === side && o.result.kind === 'point' && o.result.reason.startsWith('Rywal nie dobiegł')) xp += XP.winner;
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
    } else if (this.phase === 'move') {
      const hit = this.view.pick(x, y, ['floor']);
      if (!hit) return;
      this.moveTo = { x: hit.p.x, z: hit.p.z };
      this.view.showMove(this.moveTo);
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
    } else if (this.phase === 'move') {
      this.moveTo = { x: this.moveTo.x + d[0] * 0.2, z: this.moveTo.z - d[1] * 0.2 };
      this.view.showMove(this.moveTo);
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
