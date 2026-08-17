from fastapi import FastAPI

from app.services.job_service import run_job

app = FastAPI()


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/jobs")
def create_job(payload: dict):
    return run_job(payload)
