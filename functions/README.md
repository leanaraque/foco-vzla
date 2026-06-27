# Cloud Functions de FOCO

Funciones (2ª gen, Node 22, `us-central1`). Toda lógica que toca secretos o que no
debe ser manipulable por el cliente vive aquí (Admin SDK = bypassa rules):

- **`onConfirmacion`** (trigger Firestore `necesidades/{id}/confirmaciones/{uid}`) —
  incrementa el contador y marca `confirmada` al alcanzar N (sensible a densidad,
  rango [2,4]). El conteo autoritativo se deriva de la subcolección (COUNT), no del
  contador denormalizado → no es manipulable por el cliente.
- **`marcarAislados`** (programada, cada 60 min) — necesidades viejas sin alcanzar
  N → `pendiente_revision` (cola del operador; NUNCA se ocultan, §22.5).
- **`curador`** (programada, cada 60 min — `curador.js`) — mantiene `necesidades`
  como fuente de verdad viva: enriquece campos v2, recalcula la prioridad con
  decaimiento por frescura, y deduplica conservador marcando `duplicado_de` (alta
  confianza) o encolando en `_revision_merges` (revisión del coordinador). No borra
  nada y nunca dedup de un reporte ciudadano (§25.8).
- **`solicitarCoordinador`** (callable, App Check + rate-limit) — postulación de
  coordinador → email a `hey@leanaraque.com` vía Resend. La key vive en **Secret
  Manager** (`RESEND_API_KEY`), nunca en cliente/repo.
- **`solicitarResolucion`** (callable, App Check + rate-limit) — un usuario reporta
  que un punto del mapa está **resuelto** o aporta una **corrección**. NO cambia
  datos ni estado (eso solo lo hace un coordinador desde el Panel); solo notifica
  por correo con los detalles (§27).

## Secreto (obligatorio antes de que el correo funcione)

```bash
firebase functions:secrets:set RESEND_API_KEY   # pega la key ROTADA
# las dos callables usan el secreto; despliega ambas:
firebase deploy --only functions:solicitarCoordinador,functions:solicitarResolucion
```
> El correo NO funciona hasta poner una key válida en Secret Manager. Si alguna
> vez se filtró una key en texto plano, **rótala** antes de usarla (§22.9).

## Roles IAM requeridos (primer despliegue de 2ª gen)

Si despliegas en un proyecto nuevo, concede (una vez):

```bash
P=foco-vzla
# build service account
gcloud projects add-iam-policy-binding $P --member=serviceAccount:843653338754-compute@developer.gserviceaccount.com --role=roles/cloudbuild.builds.builder --condition=None
gcloud projects add-iam-policy-binding $P --member=serviceAccount:843653338754-compute@developer.gserviceaccount.com --role=roles/artifactregistry.writer --condition=None
gcloud projects add-iam-policy-binding $P --member=serviceAccount:843653338754-compute@developer.gserviceaccount.com --role=roles/logging.logWriter --condition=None
# runtime: acceso a Firestore (sin esto, onConfirmacion da PERMISSION_DENIED)
gcloud projects add-iam-policy-binding $P --member=serviceAccount:843653338754-compute@developer.gserviceaccount.com --role=roles/datastore.user --condition=None
# callables públicas: sin esto el formulario da "The request was not authenticated"
# (la callable valida App Check/Auth en su código; Cloud Run debe permitir invocación)
gcloud run services add-iam-policy-binding solicitarcoordinador --region us-central1 --member=allUsers --role=roles/run.invoker --project $P
gcloud run services add-iam-policy-binding solicitarresolucion --region us-central1 --member=allUsers --role=roles/run.invoker --project $P
# eventarc / pubsub / run (triggers)
gcloud projects add-iam-policy-binding $P --member=serviceAccount:service-843653338754@gcp-sa-eventarc.iam.gserviceaccount.com --role=roles/eventarc.serviceAgent --condition=None
gcloud projects add-iam-policy-binding $P --member=serviceAccount:service-843653338754@gcp-sa-pubsub.iam.gserviceaccount.com --role=roles/iam.serviceAccountTokenCreator --condition=None
gcloud projects add-iam-policy-binding $P --member=serviceAccount:843653338754-compute@developer.gserviceaccount.com --role=roles/run.invoker --condition=None
gcloud projects add-iam-policy-binding $P --member=serviceAccount:843653338754-compute@developer.gserviceaccount.com --role=roles/eventarc.eventReceiver --condition=None
```

## Deploy

```bash
cd functions && npm install
firebase deploy --only functions
```
