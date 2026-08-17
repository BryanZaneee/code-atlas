from app.services.job_service import run_job


def test_run_job():
    assert run_job({})["status"] == "queued"
