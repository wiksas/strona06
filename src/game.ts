import { T_POSITION } from './court/dimensions';
import type { CourtView } from './court/scene';
import { DIFFICULTIES, cpuDecide, cpuPickBox, type Difficulty } from './engine/ai';
import { SAMPLE_DT, sampleAt } from './engine/physics';
import { REACTION, checkShot, positionAt, type Move, type Vec2 } from './engine/rally';
import { XP, addXp, loadProgress, saveProgress, xpToNext, type Progress } from './engine/progress';
import { awardRally, newMatch, other, startNextGame, type Box, type MatchState, type Side } from './engine/rules';
import { accuracy, flightFor, pressureFactor, type ShotInput } from './engine/shots';
import { RALLY_SHOTS, SERVE_SHOTS, SHOT_LABEL, presetShot, type ShotKind } from './engine/tactics';
import { playShot, receiveStand, serveContact, serveStand, type ShotOutcome, type Striker } from './engine/turn';

type Phase = 'idle' | 'box' | 'aim' | 'move' | 'cpu' | 'anim' | 'point';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const still = (p: Vec2): Move => ({ from: p, to: p, delay: 0 });
const NAME: Record<Side, string> = { player: 'Ty', cpu: 'CPU' };
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function pressureLabel(p: number): string {
  if (p < 0.25) return 'ustawiony, pełna kontrola';
  if (p < 0.6) return 'pod presją, rozrzut większy';
  return 'rozciągnięty, rozrzut duży';
}

export class Game {
  private phase: Phase = 'idle';
  private match: MatchState | null = null;
  private difficulty: Difficulty = DIFFICULTIES[1];
  private progress: Progress;
  private storageOk: boolean;
  private striker: Striker | null = null;
  private receiverMove: Move = still(T_POSITION);
  private serveBox: Box | undefined;
  private shot: ShotInput | null = null;
  private shotKind: ShotKind | null = null;
  private moveTo: Vec2 = { ...T_POSITION };
  private rand = Math.random;
  private controls = $('controls');

  constructor(private view: CourtView) {
    const loaded = loadProgress();
    this.progress = loaded.progress;
    this.storageOk = loaded.saved;
    this.renderLevel();
    view.onTap((x, y) => this.tap(x, y));
    view.renderer.domElement.addEventListener('keydown', (e) => this.key(e));
    view.setPlayer('player', receiveStand('right'));
    view.setPlayer('cpu', serveStand('right'));
    view.setBall(null);
  }

  start(gamesToWin: number, difficultyId: string): void {
    this.view.setFrameHandler(null);
    this.difficulty = DIFFICULTIES.find((d) => d.id === difficultyId) ?? DIFFICULTIES[1];
    const first: Side = this.rand() < 0.5 ? 'player' : 'cpu';
    this.match = newMatch(gamesToWin, first);
    this.renderBoard();
    this.clearLog();
    this.log(`Losowanie rakietą: zaczyna ${first === 'player' ? 'Twój serwis' : 'serwis CPU'}.`);
    this.beginRally();
  }

  private beginRally(): void {
    const m = this.match!;
    this.clearLog();
    if (m.newHand && m.server === 'player') {
      this.phase = 'box';
      this.setPhase('Twój serwis', 'Wybierz kwadrat serwisowy. Serwujesz po przekątnej, w przeciwną tylną ćwiartkę.');
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
    const receiver = other(m.server);
    this.striker = { side: m.server, contact: serveContact(box), stand: serveStand(box), level: this.levelOf(m.server), pressure: 0 };
    this.receiverMove = still(receiveStand(box));
    this.serveBox = box;
    this.view.setPlayer(m.server, this.striker.stand);
    this.view.setPlayer(receiver, this.receiverMove.from);
    this.view.setBall(this.striker.contact);
    this.renderBoard();
    if (m.server === 'player') this.enterAim();
    else this.cpuTurn();
  }

  private levelOf(side: Side): number {
    return side === 'player' ? this.progress.level : this.difficulty.level;
  }

  private enterAim(): void {
    const s = this.striker!;
    this.phase = 'aim';
    this.shotKind = this.serveBox ? 'serveLob' : 'drive';
    this.shot = presetShot(this.shotKind, s.stand);
    this.moveTo = { ...T_POSITION };
    const serve = this.serveBox ? 'Serwis: celuj między linią serwisową a linią autu. ' : '';
    this.setPhase(
      this.serveBox ? 'Twój serwis: gdzie na ścianę?' : 'Twoje uderzenie: gdzie na ścianę?',
      `${serve}Wybierz zagranie albo stuknij ścianę${this.serveBox ? ' frontową' : ', także boczną (boast)'}. Przeciąganie obraca kort.`,
    );
    this.renderControls();
    this.preview();
  }

  private enterMove(): void {
    this.phase = 'move';
    this.setPhase('Gdzie wracasz po uderzeniu?', 'Stuknij podłogę kortu. Z T najbliżej do każdego rogu, ale stań z dala od toru piłki, inaczej grozi stroke.');
    this.view.showMove(this.moveTo);
    this.renderControls();
  }

  private preview(): void {
    const s = this.striker!;
    const f = flightFor(s.contact, this.shot!);
    const spread = accuracy(s.level).aim * pressureFactor(s.pressure) * 2;
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
    this.log(`Ty: ${this.shotKind ? SHOT_LABEL[this.shotKind] : 'własny punkt na ścianie'}.`);
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
    this.view.showAim(null, 0);
    this.view.showMove(null);
    this.view.showPath(null);
    this.renderControls();
    const receiver = other(o.striker);
    const speed = reducedMotion.matches ? 3 : 1;
    const start = performance.now();
    this.view.setFrameHandler((now) => {
      const t = Math.min(((now - start) / 1000) * speed, o.duration);
      const ball = sampleAt(o.flight, Math.min(t, o.flight.end - SAMPLE_DT));
      this.view.setBall(ball);
      this.view.setPlayer(o.striker, positionAt(o.strikerMove, t), ball);
      this.view.setPlayer(receiver, t < REACTION ? positionAt(o.receiverDrift, t) : positionAt(o.receiverMove, t), ball);
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
      if (side === 'player') {
        this.log(`Dobiegasz: ${pressureLabel(ic.pressure)}.`);
        this.enterAim();
      } else {
        this.cpuTurn();
      }
      return;
    }
    this.phase = 'point';
    if (r.kind === 'let') {
      this.log(r.reason);
      this.setPhase('Let', r.reason);
      this.renderControls(() => [this.button('Powtórz wymianę', () => this.setupServe(), true)]);
      return;
    }
    const before = this.match!;
    const m = awardRally(before, r.winner);
    this.match = m;
    this.log(r.reason);
    if (r.winner === 'player') {
      let xp = XP.rally;
      if (o.striker === 'player' && r.reason.startsWith('Rywal nie dobiegł')) xp += XP.winner;
      if (m.gameWinner === 'player') xp += XP.game;
      if (m.matchWinner === 'player') xp += XP.match;
      const { progress, levelsGained } = addXp(this.progress, xp);
      this.progress = progress;
      this.storageOk = saveProgress(progress) && this.storageOk;
      this.log(`+${xp} XP${levelsGained ? `. Awans na poziom ${progress.level}: mniejszy rozrzut uderzeń.` : ''}`);
      this.renderLevel();
    }
    this.renderBoard();
    const title = r.winner === 'player' ? 'Punkt dla Ciebie' : 'Punkt dla CPU';
    if (m.matchWinner) {
      this.setPhase(m.matchWinner === 'player' ? 'Wygrałeś mecz' : 'CPU wygrywa mecz', `${r.reason}. Gemy ${m.games.player}:${m.games.cpu}.`);
      this.renderControls(() => [this.button('Zagraj kolejny mecz', () => ($('menu') as HTMLDialogElement).showModal(), true)]);
    } else if (m.gameWinner) {
      this.setPhase(`Gem dla: ${NAME[m.gameWinner]} (${m.score.player}:${m.score.cpu})`, `${r.reason}. Gemy ${m.games.player}:${m.games.cpu}.`);
      this.renderControls(() => [this.button('Następny gem', () => {
        this.match = startNextGame(this.match!);
        this.beginRally();
      }, true)]);
    } else {
      this.setPhase(title, `${r.reason}.`);
      this.renderControls(() => [this.button('Następna wymiana', () => this.beginRally(), true)]);
    }
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
      info.innerHTML = `<div><dt>Rozrzut (2σ)</dt><dd id="spread"></dd></div><div><dt>Pozycja</dt><dd>${pressureLabel(this.striker!.pressure)}</dd></div>`;
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
        this.phase = 'aim';
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
    const m = this.match;
    if (!m) return;
    for (const side of ['player', 'cpu'] as const) {
      $(`score-${side}`).textContent = String(m.score[side]);
      $(`games-${side}`).textContent = String(m.games[side]);
      document.querySelector(`.board-side[data-side="${side}"]`)!.toggleAttribute('data-serving', m.server === side);
    }
    $('board').setAttribute('aria-label', `Wynik: Ty ${m.score.player}, CPU ${m.score.cpu}. Gemy ${m.games.player}:${m.games.cpu}. Serwuje: ${NAME[m.server]}.`);
  }

  private renderLevel(): void {
    const { level, xp } = this.progress;
    const need = xpToNext(level);
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
