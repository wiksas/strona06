import '@fontsource/barlow/400.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './styles.css';
import { CourtView, VIEWS } from './court/scene';
import type { Side } from './engine/rules';
import { Game, type Mode } from './game';
import { SHIRTS, SHORTS, loadProfiles, type Profile } from './profiles';

const status = document.getElementById('court-status')!;
const menu = document.getElementById('menu') as HTMLDialogElement;
const menuForm = document.getElementById('menu-form') as HTMLFormElement;
const rules = document.getElementById('rules') as HTMLDialogElement;
const players = document.getElementById('players') as HTMLDialogElement;
const playersForm = document.getElementById('players-form') as HTMLFormElement;
const playersFields = document.getElementById('players-fields')!;
const cpuLevel = document.getElementById('cpu-level') as HTMLFieldSetElement;

let view: CourtView;
try {
  view = new CourtView(document.getElementById('court')!);
  status.hidden = true;
} catch {
  status.textContent = 'Nie udało się uruchomić grafiki 3D (WebGL). Włącz akcelerację sprzętową lub otwórz grę w innej przeglądarce.';
  status.classList.add('error');
  throw new Error('WebGL unavailable');
}

const loaded = loadProfiles();
let profiles = loaded.profiles;
const game = new Game(view, profiles, loaded.saved);

document.getElementById('open-rules')!.addEventListener('click', () => rules.showModal());
document.getElementById('open-menu')!.addEventListener('click', () => menu.showModal());
document.getElementById('menu-cancel')!.addEventListener('click', () => menu.close('cancel'));
document.getElementById('players-cancel')!.addEventListener('click', () => players.close('cancel'));
document.getElementById('open-players')!.addEventListener('click', () => {
  renderPlayersForm();
  players.showModal();
});

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
  b.addEventListener('click', () => view.setView(b.dataset.view as keyof typeof VIEWS)),
);
document.querySelectorAll<HTMLButtonElement>('[data-rotate]').forEach((b) =>
  b.addEventListener('click', () => view.rotate(Number(b.dataset.rotate) * (Math.PI / 8))),
);

menuForm.addEventListener('change', () => {
  cpuLevel.disabled = new FormData(menuForm).get('mode') === 'hotseat';
});
menu.addEventListener('close', () => {
  if (menu.returnValue !== 'start') return;
  const data = new FormData(menuForm);
  game.start(data.get('mode') as Mode, Number(data.get('games')), String(data.get('cpu')));
});

function swatchGroup(side: Side, kind: 'shirt' | 'shorts', options: { color: string; label: string }[], current: string): HTMLFieldSetElement {
  const fs = document.createElement('fieldset');
  fs.className = 'swatches';
  fs.innerHTML = `<legend>${kind === 'shirt' ? 'Koszulka' : 'Spodenki'}</legend>`;
  for (const o of options) {
    const label = document.createElement('label');
    label.className = 'swatch-option';
    label.title = o.label;
    label.innerHTML = `<input type="radio" name="${side}-${kind}" value="${o.color}"><span class="chip" style="--c:${o.color}" aria-hidden="true"></span><span class="sr-only">${o.label}</span>`;
    const input = label.querySelector('input')!;
    input.checked = o.color === current;
    fs.append(label);
  }
  return fs;
}

/** Each player's shirt is disabled in the other player's list so the two never match. */
function syncShirtLocks(): void {
  for (const side of ['p1', 'p2'] as const) {
    const otherSide = side === 'p1' ? 'p2' : 'p1';
    const taken = playersForm.querySelector<HTMLInputElement>(`input[name="${otherSide}-shirt"]:checked`)?.value;
    playersForm.querySelectorAll<HTMLInputElement>(`input[name="${side}-shirt"]`).forEach((i) => {
      i.disabled = i.value === taken;
    });
  }
}

function renderPlayersForm(): void {
  playersFields.replaceChildren();
  for (const side of ['p1', 'p2'] as const) {
    const p = profiles[side];
    const box = document.createElement('section');
    box.className = 'player-card';
    const title = side === 'p1' ? 'Gracz 1' : 'Gracz 2';
    box.innerHTML = `<h3>${title} <span class="muted">poziom ${p.progress.level}</span></h3>
      <label class="text-field">Imię<input type="text" name="${side}-name" maxlength="16" required autocomplete="off"></label>`;
    box.querySelector('input')!.value = p.name;
    box.append(swatchGroup(side, 'shirt', SHIRTS, p.outfit.shirt), swatchGroup(side, 'shorts', SHORTS, p.outfit.shorts));
    playersFields.append(box);
  }
  syncShirtLocks();
}
playersForm.addEventListener('change', syncShirtLocks);

players.addEventListener('close', () => {
  if (players.returnValue !== 'save') return;
  const data = new FormData(playersForm);
  const next = structuredClone(profiles) as Record<Side, Profile>;
  for (const side of ['p1', 'p2'] as const) {
    next[side].name = String(data.get(`${side}-name`)).trim().slice(0, 16) || next[side].name;
    next[side].outfit = { shirt: String(data.get(`${side}-shirt`)), shorts: String(data.get(`${side}-shorts`)) };
  }
  profiles = next;
  game.setProfiles(next);
});

menu.showModal();
