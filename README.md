# Skłosz

Taktyczna gra w squasha: wybierasz punkt na ścianie, siłę uderzenia i miejsce, do którego wracasz po zagraniu. Komputer robi to samo. Mecz gemów do 11 punktów (PAR-11, przy 10:10 gra na przewagę 2 punktów).

## Uruchomienie

```
npm install
npm run dev      # serwer deweloperski, dostępny też w sieci lokalnej (telefon)
npm test         # testy silnika zasad i fizyki
npm run build    # wersja produkcyjna w dist/
```

Każdy push na `main` buduje i publikuje grę przez GitHub Actions na GitHub Pages
(Settings → Pages → Source: GitHub Actions).
