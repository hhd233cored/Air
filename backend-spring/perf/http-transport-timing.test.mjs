import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { timedFetchText, transportStages } from './http-transport-timing.mjs';

test('concurrent requests retain their own diagnostics and body latency', async () => {
  const server = createServer((req,res) => {
    res.writeHead(200, {'Content-Type':'text/plain'});
    res.write(req.url);
    setTimeout(() => res.end('done'), req.url === '/slow' ? 50 : 5);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const [slow,fast,off] = await Promise.all([
      timedFetchText(base+'/slow',{},true), timedFetchText(base+'/fast',{},true),
      timedFetchText(base+'/off',{},false)]);
    assert.equal(slow.body,'/slowdone'); assert.equal(fast.body,'/fastdone');
    assert.equal(off.transport,null);
    for (const row of [slow,fast]) {
      assert.ok(row.transport);
      const t=row.transport;
      const sum=t.clientCallToCreate+t.clientCreateToSend+t.clientSend+t.clientAwaitHeaders
        +t.clientHeadersDelivery+t.clientBodyConsume;
      assert.ok(Math.abs(sum-row.ms)<0.001);
      assert.ok(t.clientAfterWire>=0);
    }
    assert.ok(slow.transport.clientBodyWire>fast.transport.clientBodyWire+15);
  } finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
});

test('missing or unordered diagnostics are absent rather than zero', () => {
  assert.equal(transportStages({start:1,done:4}),null);
  assert.equal(transportStages({start:1,created:2,sent:1,bodySent:3,headers:4,resolved:5,done:6}),null);
});
