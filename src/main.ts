import '@fontsource/barlow/400.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './styles.css';
import { CourtView, VIEWS } from './court/scene';
import { Game } from './game';

const status = document.getElementById('court-status')!;
const menu = document.getElementById('menu') as HTMLDialogElement;
const rules = document.getElementById('rules') as HTMLDialogElement;

document.getElementById('open-rules')!.addEventListener('click', () => rules.showModal());
document.getElementById('open-menu')!.addEventListener('click', () => menu.showModal());
document.getElementById('menu-cancel')!.addEventListener('click', () => menu.close('cancel'));

let view: CourtView;
try {
  view = new CourtView(document.getElementById('court')!);
  status.hidden = true;
} catch {
  status.textContent = 'Nie udało się uruchomić grafiki 3D (WebGL). Włącz akcelerację sprzętową lub otwórz grę w innej przeglądarce.';
  status.classList.add('error');
  throw new Error('WebGL unavailable');
}

const game = new Game(view);

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
  b.addEventListener('click', () => view.setView(b.dataset.view as keyof typeof VIEWS)),
);
document.querySelectorAll<HTMLButtonElement>('[data-rotate]').forEach((b) =>
  b.addEventListener('click', () => view.rotate(Number(b.dataset.rotate) * (Math.PI / 8))),
);

menu.addEventListener('close', () => {
  if (menu.returnValue !== 'start') return;
  const data = new FormData(document.getElementById('menu-form') as HTMLFormElement);
  game.start(Number(data.get('games')), String(data.get('cpu')));
});
menu.showModal();
