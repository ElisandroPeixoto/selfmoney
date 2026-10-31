from fastapi.testclient import TestClient

URL = "/api/spending-collections"


def make(client: TestClient, name: str = "Assinaturas", **extra) -> dict:
    response = client.post(URL, json={"name": name, **extra})
    assert response.status_code == 201, response.text
    return response.json()


def test_items_are_summed(client: TestClient) -> None:
    collection = make(client)
    assert collection["total"] == "0.00"
    assert collection["currency"] == "BRL"

    cid = collection["id"]
    client.post(f"{URL}/{cid}/items", json={"name": "Netflix", "amount": "55.9"})
    collection = client.post(
        f"{URL}/{cid}/items", json={"name": "Spotify", "amount": "21.90"}
    ).json()
    assert collection["total"] == "77.80"
    assert [i["name"] for i in collection["items"]] == ["Netflix", "Spotify"]
    assert collection["items"][0]["amount"] == "55.90"

    netflix = collection["items"][0]["id"]
    collection = client.delete(f"{URL}/{cid}/items/{netflix}").json()
    assert collection["total"] == "21.90"
    assert client.delete(f"{URL}/{cid}/items/{netflix}").status_code == 404
    assert client.get(URL).json()[0]["total"] == "21.90"


def test_item_validation(client: TestClient) -> None:
    cid = make(client)["id"]
    for payload in (
        {"name": "x", "amount": "0"},
        {"name": "x", "amount": "-1"},
        {"name": "  ", "amount": "1"},
        {"name": "x", "amount": "1.999"},
    ):
        assert client.post(f"{URL}/{cid}/items", json=payload).status_code == 422
    assert client.post(f"{URL}/999/items", json={"name": "x", "amount": "1"}).status_code == 404


def test_collection_crud_and_unique_names(client: TestClient) -> None:
    a = make(client, "Assinaturas")
    b = make(client, "Seguros", currency="USD")
    assert [c["name"] for c in client.get(URL).json()] == ["Assinaturas", "Seguros"]
    assert b["currency"] == "USD"

    assert client.post(URL, json={"name": "Assinaturas"}).status_code == 409
    assert client.post(URL, json={"name": "   "}).status_code == 422
    assert client.patch(f"{URL}/{b['id']}", json={"name": "Assinaturas"}).status_code == 409
    renamed = client.patch(f"{URL}/{b['id']}", json={"name": " Clube "}).json()
    assert renamed["name"] == "Clube"
    assert client.patch(f"{URL}/{b['id']}", json={"name": None}).status_code == 422
    assert client.patch(f"{URL}/999", json={"name": "x"}).status_code == 404

    client.post(f"{URL}/{a['id']}/items", json={"name": "Netflix", "amount": "10"})
    assert client.delete(f"{URL}/{a['id']}").status_code == 204
    assert [c["name"] for c in client.get(URL).json()] == ["Clube"]
    assert client.delete(f"{URL}/{a['id']}").status_code == 404
