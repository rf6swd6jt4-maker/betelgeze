# Betelgeze Leadgen NER

Small FastAPI service for owner-name validation. Deploy it as a separate service and point the Next app at `/person-ner`.

## Local Run

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload --port 8010
```

## API

```bash
curl -X POST http://localhost:8010/person-ner \
  -H "content-type: application/json" \
  -d '{"items":[{"id":"1","candidate":"Maria Lopez","text":"Run by Maria Lopez, owner and president."}]}'
```

With `NER_TOKEN` set, send `Authorization: Bearer <token>`.

## Vercel Deployment

Create a separate Vercel project with `services/ner` as the project root. Vercel will detect `app.py` and `requirements.txt` as a Python function project.

Set service environment variables:

```txt
NER_MODEL=en_core_web_sm
NER_TOKEN=<long random secret>
```

After deployment, set the main Next app's `LEADGEN_NER_ENDPOINT` to:

```txt
https://<ner-project-domain>/person-ner
```
