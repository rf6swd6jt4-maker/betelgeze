import os
import re
from typing import Any

import spacy
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field


MODEL_NAME = os.getenv("NER_MODEL", "en_core_web_sm")
NER_TOKEN = os.getenv("NER_TOKEN", "").strip()

nlp = spacy.load(MODEL_NAME)
app = FastAPI(title="Betelgeze Leadgen NER", version="1.0.0")


class NerItem(BaseModel):
    id: str
    text: str = ""
    candidate: str = ""


class NerRequest(BaseModel):
    items: list[NerItem] = Field(default_factory=list)


def compact_key(value: str) -> str:
    return "".join(re.findall(r"[a-z]+", value.lower()))


def clean_name(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip(" \t\r\n.,;:-|/")


def candidate_match(candidate: str, person: str) -> bool:
    candidate_key = compact_key(candidate)
    person_key = compact_key(person)
    if not person_key:
        return False
    if not candidate_key:
        return True
    return candidate_key == person_key or candidate_key in person_key or person_key in candidate_key


def authorize(authorization: str | None, x_ner_token: str | None) -> None:
    if not NER_TOKEN:
        return
    bearer = authorization or ""
    token = bearer.removeprefix("Bearer ").strip() if bearer.lower().startswith("bearer ") else x_ner_token or ""
    if token != NER_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid NER token")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model": MODEL_NAME}


@app.post("/person-ner")
def person_ner(
    request: NerRequest,
    authorization: str | None = Header(default=None),
    x_ner_token: str | None = Header(default=None),
) -> dict[str, list[dict[str, Any]]]:
    authorize(authorization, x_ner_token)
    results: list[dict[str, Any]] = []
    for item in request.items[:100]:
        text = item.text[:5000]
        doc = nlp(text)
        persons = [clean_name(ent.text) for ent in doc.ents if ent.label_ == "PERSON"]
        persons = list(dict.fromkeys([person for person in persons if person]))
        accepted = next((person for person in persons if candidate_match(item.candidate, person)), None)
        results.append({
            "id": item.id,
            "persons": persons,
            "acceptedName": accepted,
            "confidence": 88 if accepted else 0,
        })
    return {"items": results}
