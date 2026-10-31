from datetime import datetime, timedelta

from fastapi.testclient import TestClient


def test_record_list_and_delete(client: TestClient) -> None:
    assert client.get("/api/balance-checks").json() == []

    first = client.post("/api/balance-checks")
    assert first.status_code == 201
    second = client.post("/api/balance-checks").json()

    # Timestamps are UTC with an explicit offset and close to "now".
    created = datetime.fromisoformat(first.json()["created_at"])
    assert created.utcoffset() == timedelta(0)
    assert abs(datetime.now(created.tzinfo) - created) < timedelta(minutes=1)

    listed = client.get("/api/balance-checks").json()
    assert [c["id"] for c in listed] == [second["id"], first.json()["id"]]

    assert client.delete(f"/api/balance-checks/{second['id']}").status_code == 204
    assert [c["id"] for c in client.get("/api/balance-checks").json()] == [first.json()["id"]]
    assert client.delete(f"/api/balance-checks/{second['id']}").status_code == 404
