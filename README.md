# Piru Pinball 3D

Pinball para Android en 3D, de estilo retro y con gráficos modernos: mesa de neón synthwave, bola cromada con reflejos, bloom, partículas, ondas expansivas, cámara lenta en los jackpots y marcador de matriz de puntos.

- Flippers, 3 bumpers, 2 slingshots, dianas abatibles, dianas fijas, pasillos P-I-R con cambio de pasillo, órbitas, agujero con LOCK, multibola de 3 bolas y jackpot.
- Kickback, bola salvada, multiplicador de bonus hasta x5 y skill shot.
- Controles: toca la mitad izquierda o derecha de la pantalla; mantén abajo a la derecha para tirar del lanzador.

## Cómo se genera la APK
Cada vez que se sube un cambio a `main`, GitHub Actions compila la APK firmada y la publica en
**Releases → "Piru Pinball 3D (última versión)"**. La firma es siempre la misma (`pirupinball.jks` + secreto `KEYSTORE_PASS`).

## Actualización automática
La app descarga sola `index.html`, `game.js` y `three.min.js` de este repositorio cuando sube el número de `version.txt`,
así que los cambios del juego llegan sin instalar otra APK.
