from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_homepage() -> None:
    response = client.get('/')
    assert response.status_code == 200
    assert 'AI合规扫描仪' in response.text


def test_health() -> None:
    response = client.get('/health')
    assert response.status_code == 200
    payload = response.json()
    assert payload['status'] == 'ok'


def test_sync_text_scan() -> None:
    response = client.post(
        '/api/v1/scan/text?wait=true',
        json={
            'mode': 'ad_copy',
            'title': 'test ad',
            'text': '全网第一，7天立刻见效，保证通过。',
            'use_llm': False,
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload['status'] == 'completed'
    result = payload['result']
    assert result['risk_score'] > 0
    assert len(result['risk_items']) >= 1
