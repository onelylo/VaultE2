const http = require('http');
function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({hostname:'127.0.0.1', port:3001, path, method:'POST', headers:{'Content-Type':'application/json','Content-Length':data.length}}, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({status:res.statusCode, body:JSON.parse(body)}));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
async function run() {
  const r = await post('/api/auth/login', {username:'alice_f5_mso34gte', password:'pass1234'});
  console.log('Login:', r.status, JSON.stringify(r.body));
  const r2 = await post('/api/auth/register', {username:'wipe_fresh_test', password:'test1234', role:'ADMIN', publicKey:'TEST'});
  console.log('Register:', r2.status, JSON.stringify(r2.body));
}
run();
