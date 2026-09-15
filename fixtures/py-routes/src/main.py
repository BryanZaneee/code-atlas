from fastapi import FastAPI

app = FastAPI()


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/v1/documents")
def upload():
    """Upload a document.

    Superseded @app.get("/v1/documents/legacy") -- prose, not a route.
    """
    return {}


# @app.get("/deleted-last-year")
# def gone():
#     return {}
