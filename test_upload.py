import requests, os

BASE = 'http://127.0.0.1:5000'

s = requests.Session()
# login as resident
resp = s.post(BASE + '/login', json={'email':'resident@example.com','password':'resident123'})
print('Login status:', resp.status_code)

# create a small test file
fname = 'test_upload.txt'
with open(fname, 'wb') as f:
    f.write(b'Test file content')

# Prepare multipart form
with open(fname, 'rb') as fh:
    files = {'digital_document': fh}
    # choose a document that supports digital (document_id 1 exists)
    data = {'document_id': '1', 'delivery_method': 'Digital'}
    resp = s.post(BASE + '/resident/submit-request', data=data, files=files)
print('Upload status:', resp.status_code)
try:
    print(resp.json())
except Exception:
    print(resp.text)

# cleanup
os.remove(fname)
