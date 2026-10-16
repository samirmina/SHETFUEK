const p = require('./extension/native-host/ollama_client');
p.chat([{role:'system',content:'Return only valid JSON: {"ok":1}'},{role:'user',content:'hi'}]).then(r=>{
  console.log(r.content);
}).catch(e=>{
  console.error('err');
});
