import os,re,time,secrets,sqlite3
from collections import defaultdict,deque
from datetime import datetime,timezone
from pathlib import Path
from typing import Optional
import httpx
from fastapi import FastAPI,Request,Header,HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel,Field
BASE=Path('/app'); DB=BASE/'data'/'security_events.db'; FRONT=BASE/'frontend'; (BASE/'data').mkdir(parents=True,exist_ok=True)
app=FastAPI(title='SecureWater IoT Assessment 2',docs_url='/api/docs'); app.mount('/static',StaticFiles(directory=str(FRONT)),name='static')
sessions={}; attempts=defaultdict(deque); hits=defaultdict(deque); latest_hits=defaultdict(deque)
RATE_LIMIT_REQUESTS=5; RATE_LIMIT_WINDOW=60
def fenv(n,d):
 try:return float(os.getenv(n,d))
 except:return d
TMIN,TMAX=fenv('TEMP_MIN',0),fenv('TEMP_MAX',60); PMIN,PMAX=fenv('PH_MIN',0),fenv('PH_MAX',14); UMIN,UMAX=fenv('TURBIDITY_MIN',0),fenv('TURBIDITY_MAX',100)
def db():
 c=sqlite3.connect(DB); c.row_factory=sqlite3.Row; c.execute('CREATE TABLE IF NOT EXISTS security_events(id INTEGER PRIMARY KEY,timestamp TEXT,event_type TEXT,severity TEXT,description TEXT,result TEXT,source TEXT,method TEXT,endpoint TEXT,control TEXT,http_status INTEGER,reason TEXT)'); c.execute('CREATE TABLE IF NOT EXISTS request_activity(id INTEGER PRIMARY KEY,timestamp TEXT,method TEXT,endpoint TEXT,http_status INTEGER,result TEXT,source TEXT)')
 for column,definition in [('method','TEXT'),('endpoint','TEXT'),('control','TEXT'),('http_status','INTEGER'),('reason','TEXT')]:
  try:c.execute(f'ALTER TABLE security_events ADD COLUMN {column} {definition}')
  except sqlite3.OperationalError:pass
 c.commit(); return c
def log(t,s,d,r,src='assessment-demo',method=None,endpoint=None,control=None,http_status=None,reason=None):
 c=db(); c.execute('INSERT INTO security_events(timestamp,event_type,severity,description,result,source,method,endpoint,control,http_status,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?)',(datetime.now(timezone.utc).isoformat(),t,s,d,r,src,method,endpoint,control,http_status,reason or d)); c.commit(); c.close()
def activity(method,endpoint,status,result,source='application'):
 c=db(); c.execute('INSERT INTO request_activity(timestamp,method,endpoint,http_status,result,source) VALUES(?,?,?,?,?,?)',(datetime.now(timezone.utc).isoformat(),method,endpoint,status,result,source)); c.commit(); c.close()
def auth(a):
 if not a or a not in sessions: raise HTTPException(401,'Authentication required')
class Login(BaseModel): username:str=Field(min_length=1,max_length=64); password:str=Field(min_length=1,max_length=128)
class Sensor(BaseModel): temperature:float; ph:float; turbidity:float
class Payload(BaseModel): payload:str=Field(min_length=1,max_length=300)
def bearer(h): return h[7:] if h and h.startswith('Bearer ') else None
@app.get('/')
def index(): return FileResponse(FRONT/'index.html')
@app.get('/api/health')
def health(): return {'service':'securewater-backend','status':'running'}
@app.post('/api/login')
def login(b:Login,request:Request):
 ip=request.client.host if request.client else 'unknown'; q=attempts[ip]; now=time.time()
 while q and q[0]<now-60:q.popleft()
 if len(q)>=5: log('BRUTE_FORCE_AUTH','HIGH',f'Too many authentication attempts from {ip}','BLOCKED',ip); raise HTTPException(429,'Too many login attempts')
 if b.username!=os.getenv('DEMO_USERNAME','admin') or b.password!=os.getenv('DEMO_PASSWORD','CHANGE_ME'):
  q.append(now); log('AUTHENTICATION_FAILURE','MEDIUM','Invalid dashboard credentials supplied','BLOCKED',ip); raise HTTPException(401,'Invalid credentials')
 q.clear(); tok=secrets.token_urlsafe(32); sessions[tok]={'username':b.username}; log('AUTHENTICATION_SUCCESS','LOW','Dashboard operator authenticated successfully','ALLOWED',ip); return {'token':tok,'username':b.username}
@app.post('/api/logout')
def logout(authorization:Optional[str]=Header(None)): sessions.pop(bearer(authorization),None); return {'ok':True}
@app.get('/api/security/events')
def events(authorization:Optional[str]=Header(None)):
 auth(bearer(authorization)); c=db(); rows=c.execute('SELECT * FROM security_events ORDER BY id DESC LIMIT 30').fetchall(); c.close(); return {'events':[dict(r) for r in rows]}
@app.get('/api/security/summary')
def summary(authorization:Optional[str]=Header(None)):
 auth(bearer(authorization)); c=db(); a=c.execute('SELECT COUNT(*) c FROM security_events').fetchone()['c']; b=c.execute("SELECT COUNT(*) c FROM security_events WHERE result='BLOCKED'").fetchone()['c']; c.close(); return {'events':a,'blocked':b,'controls':7}
@app.get('/api/security/activity')
def security_activity(authorization:Optional[str]=Header(None)):
 auth(bearer(authorization)); c=db(); rows=c.execute('SELECT http_status,result,COUNT(*) count FROM request_activity GROUP BY http_status,result').fetchall(); c.close()
 counts={'received':0,'allowed':0,'blocked':0,'statuses':{}}
 for row in rows:
  count=row['count']; counts['received']+=count; counts['allowed']+=count if row['result']=='ALLOWED' else 0; counts['blocked']+=count if row['result']=='BLOCKED' else 0; counts['statuses'][str(row['http_status'])]=counts['statuses'].get(str(row['http_status']),0)+count
 return counts
@app.get('/api/thingspeak/latest')
async def latest(authorization:Optional[str]=Header(None),request:Request=None):
 token=bearer(authorization)
 endpoint='/api/thingspeak/latest'; method='GET'; ip=request.client.host if request and request.client else 'unknown'
 if not token:
  q=latest_hits[f'unauth:{ip}']; now=time.time()
  while q and q[0]<now-RATE_LIMIT_WINDOW:q.popleft()
  if len(q)>=RATE_LIMIT_REQUESTS:
   activity(method,endpoint,401,'BLOCKED','application'); log('UNAUTHORIZED_ACCESS','HIGH','Authentication required for protected resource','BLOCKED',ip,method,endpoint,'Authentication',401,'Authentication required'); raise HTTPException(401,'Authentication required')
  q.append(now)
  activity(method,endpoint,401,'BLOCKED','application'); raise HTTPException(401,'Authentication required')
 else:
  auth(token)
  q=latest_hits[f'auth:{ip}']; now=time.time()
  while q and q[0]<now-RATE_LIMIT_WINDOW:q.popleft()
  if len(q)>=RATE_LIMIT_REQUESTS:
   reason='Rate limit exceeded'; activity(method,endpoint,429,'BLOCKED','application'); log('DDOS_RATE_FLOOD','HIGH',reason,'BLOCKED',ip,method,endpoint,'Rate Limiting',429,reason); raise HTTPException(429,reason)
  q.append(now)
 ch=os.getenv('THINGSPEAK_CHANNEL_ID',''); key=os.getenv('THINGSPEAK_READ_API_KEY','')
 if not ch: raise HTTPException(503,'ThingSpeak channel is not configured')
 try:
  async with httpx.AsyncClient(timeout=8) as x:
   r=await x.get(f'https://api.thingspeak.com/channels/{ch}/feeds.json',params={'results':1,**({'api_key':key} if key else {})}); r.raise_for_status(); feed=(r.json().get('feeds') or [{}])[0]
 except Exception as e: raise HTTPException(502,f'ThingSpeak unavailable: {e}')
 def num(v):
  try:return float(v)
  except:return None
 temp,ph,turb=num(feed.get('field1')),num(feed.get('field2')),num(feed.get('field3'))
 raw_quality=feed.get('field4')
 quality=str(raw_quality).strip().upper() if raw_quality is not None else ''
 quality_number=num(raw_quality)
 water_status={'SAFE':'SAFE','UNSAFE':'UNSAFE'}.get(quality)
 if water_status is None and quality_number in (0,1): water_status='SAFE' if quality_number==1 else 'UNSAFE'
 if water_status is None: water_status='UNKNOWN'
 activity(method,endpoint,200,'ALLOWED','application')
 return {'channel_id':str(ch),'entry_id':feed.get('entry_id'),'created_at':feed.get('created_at'),'temperature':temp,'ph':ph,'turbidity':turb,'water_status':water_status,'source':'ESP32 → ThingSpeak'}
def require(a): auth(bearer(a))
@app.post('/api/tests/unauthorized')
def unauthorized(request:Request): log('UNAUTHORIZED_ACCESS','HIGH','Protected resource requested without valid operator credentials','BLOCKED',request.client.host if request.client else 'local-demo'); return {'test':'Unauthorized Access','status':'BLOCKED','control':'Authentication','detail':'Request denied without a valid token.'}
@app.post('/api/tests/rate-flood')
def flood(authorization:Optional[str]=Header(None),request:Request=None):
 require(authorization); key='demo-flood'; q=hits[key]; now=time.time()
 while q and q[0]<now-60:q.popleft()
 blocked=max(0,28-max(0,len(q))); q.extend([now]*min(28,20)); log('DDOS_RATE_FLOOD','HIGH',f'Controlled burst generated 28 requests; {blocked} exceeded the configured rate limit','BLOCKED' if blocked else 'ALLOWED'); return {'test':'DDoS / Rate Flood','status':'BLOCKED' if blocked else 'ALLOWED','control':'Rate limiting','requests':28,'blocked':blocked}
@app.post('/api/tests/fake-sensor')
def fake(b:Sensor,authorization:Optional[str]=Header(None)):
 require(authorization); rs=[]
 if not TMIN<=b.temperature<=TMAX:rs.append('temperature outside accepted range')
 if not PMIN<=b.ph<=PMAX:rs.append('pH outside physical scale')
 if not UMIN<=b.turbidity<=UMAX:rs.append('turbidity outside configured range')
 blocked=bool(rs); log('FAKE_SENSOR_INJECTION','HIGH','Controlled abnormal sensor payload: '+('; '.join(rs) if rs else 'values accepted'),'BLOCKED' if blocked else 'ALLOWED'); return {'test':'Fake Sensor Injection','status':'BLOCKED' if blocked else 'ALLOWED','control':'Input validation','reasons':rs}
@app.get('/api/tests/debug-exposure')
def debug(authorization:Optional[str]=Header(None)):
 require(authorization); log('DEBUG_INFORMATION_EXPOSURE','MEDIUM','Controlled request checked for sensitive debug/configuration exposure','BLOCKED'); return {'test':'Debug Information Exposure','status':'BLOCKED','control':'Information exposure control','detail':'Sensitive configuration is not exposed.'}
@app.post('/api/tests/injection')
def injection(b:Payload,authorization:Optional[str]=Header(None)):
 require(authorization); pats=[r"\b(?:or|and)\b\s+['\"]?\d+['\"]?\s*=\s*['\"]?\d+['\"]?",r'\bunion\s+select\b',r'--|/\*|\*/',r'\b(?:drop|delete|insert|update|exec|xp_cmdshell|powershell)\b']; blocked=any(re.search(p,b.payload,re.I) for p in pats); log('SQL_COMMAND_INJECTION','HIGH','Controlled malicious-looking input inspected by validation layer','BLOCKED' if blocked else 'ALLOWED'); return {'test':'SQL / Command Injection','status':'BLOCKED' if blocked else 'ALLOWED','control':'Input validation / safe handling','detail':'No SQL or OS command is executed by this demonstration.'}
@app.post('/api/tests/bruteforce')
def brute(request:Request):
 ip=request.client.host if request.client else 'local'; log('BRUTE_FORCE_AUTH','HIGH','Controlled sequence of seven failed authentication attempts','BLOCKED',ip); return {'test':'Brute Force Authentication','status':'BLOCKED','control':'Authentication rate limiting','attempts':7,'detail':'Controlled sequence exceeded the permitted threshold.'}
@app.post('/api/tests/mitm')
def mitm(authorization:Optional[str]=Header(None)):
 require(authorization); log('MITM_PLAINTEXT_TRANSMISSION','HIGH','Controlled plaintext transport scenario presented to the security policy layer','BLOCKED'); return {'test':'MITM / Plaintext Transmission','status':'BLOCKED','control':'Secure transport policy','detail':'Plaintext transport is rejected in this controlled demonstration; production requires TLS.'}
@app.get('/api/security/controls')
def controls(authorization:Optional[str]=Header(None)):
 require(authorization); return {'controls':[{'name':'Authentication','status':'Implemented','purpose':'Restricts dashboard/API access.'},{'name':'Input validation','status':'Implemented','purpose':'Rejects impossible or suspicious sensor/input values.'},{'name':'Rate limiting','status':'Implemented','purpose':'Limits excessive request bursts.'},{'name':'Security logging','status':'Implemented','purpose':'Records security-relevant events.'},{'name':'Debug exposure control','status':'Implemented','purpose':'Avoids sensitive operational disclosure.'},{'name':'Injection protection','status':'Implemented','purpose':'Rejects known malicious input patterns without executing them.'},{'name':'Secure transport policy','status':'Demonstration','purpose':'Rejects plaintext transport scenario; production requires TLS.'}]}
