import requests
BASE='http://127.0.0.1:5000'

s=requests.Session()
resp=s.post(BASE+'/login', json={'email':'resident@example.com','password':'resident123'})
print('login', resp.status_code)
reqs = s.get(BASE+'/api/resident/requests').json()
print('requests count', len(reqs))
# find a request with digital_file_url
url=None
for r in reqs:
    if r.get('digital_file_url'):
        url=r['digital_file_url']; break
print('file url', url)
if url:
    full = url if url.startswith('http') else BASE + url
    r=s.get(full)
    print('download status', r.status_code)
    if r.ok:
        with open('downloaded_test', 'wb') as f:
            f.write(r.content)
        print('saved downloaded_test')
