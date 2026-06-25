# Cloud Functions de FOCO

Funciones (2ª gen, Node 22, `us-central1`):

- **`solicitarCoordinador`** (callable, App Check) — postulación de coordinador →
  email a `hey@leanaraque.com` vía Resend. La key vive en **Secret Manager**
  (`RESEND_API_KEY`), nunca en cliente/repo.
- **`onConfirmacion`** (trigger Firestore `necesidades/{id}/confirmaciones/{uid}`) —
  incrementa el contador y marca `confirmada` al alcanzar N (sensible a densidad,
  rango [2,4]). El contador no es manipulable por el cliente.
- **`marcarAislados`** (programada, cada 60 min) — necesidades viejas sin alcanzar
  N → `pendiente_revision` (cola del operador; NUNCA se ocultan, §22.5).

## Secreto (obligatorio antes de que el correo funcione)

```bash
firebase functions:secrets:set RESEND_API_KEY   # pega la key ROTADA
firebase deploy --only functions:solicitarCoordinador
```
> La key compartida en texto plano está comprometida; en staging hay un
> **placeholder**. El correo NO funciona hasta poner la key rotada (§22.9).

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
# callable público: sin esto el formulario da "The request was not authenticated"
# (la callable valida App Check/Auth en su código; Cloud Run debe permitir invocación)
gcloud run services add-iam-policy-binding solicitarcoordinador --region us-central1 --member=allUsers --role=roles/run.invoker --project $P
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
