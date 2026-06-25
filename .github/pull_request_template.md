<!-- Gracias por contribuir a FOCO. Un PR, un tema. Lee CONTRIBUTING.md. -->

## Qué cambia
<!-- Describe el cambio en una o dos frases. -->

## Por qué
<!-- El problema que resuelve. Enlaza el issue si aplica (Closes #123). -->

## Cómo se probó
<!-- Comandos corridos y resultado. Si tocas UI, ¿lo probaste en throttling 3G? -->
- [ ] `npm run test:unit`
- [ ] `firebase emulators:exec --only firestore "npm run test:rules"`
- [ ] Probado en móvil / red lenta (si aplica) — ver TESTING.md

## Checklist
- [ ] El cambio es pequeño y enfocado.
- [ ] Sigo el estilo del código alrededor.
- [ ] No añadí dependencias pesadas sin justificar el peso (objetivo 2G/3G).
- [ ] No subí datos reales de personas afectadas (solo ficticios).

## Impacto sensible (marca si aplica y explica abajo)
- [ ] Toca **privacidad** (contacto, coords exactas, subdoc privado).
- [ ] Toca **security rules** (`firestore.rules`) → **incluye tests**.
- [ ] Afecta el **costo de Firestore** (lecturas, listeners, paginación).
- [ ] Cambia el **alcance** definido en la spec.

<!-- Si marcaste alguno, explica el porqué aquí: -->
