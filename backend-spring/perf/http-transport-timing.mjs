import { AsyncLocalStorage } from 'node:async_hooks';
import { channel } from 'node:diagnostics_channel';
import { performance } from 'node:perf_hooks';

const context = new AsyncLocalStorage();
const requests = new WeakMap();
let installed = false;
function installDiagnostics() {
  if (installed) return;
  installed = true;
  channel('undici:request:create').subscribe(({ request }) => {
    const sample = context.getStore();
    if (sample && !sample.created) {
      sample.created = performance.now();
      requests.set(request, sample);
    }
  });
  for (const [name, field] of [['undici:client:sendHeaders','sent'],
      ['undici:request:bodySent','bodySent'], ['undici:request:headers','headers'],
      ['undici:request:trailers','wireDone']]) {
    channel(name).subscribe(({ request }) => {
      const sample = requests.get(request);
      if (sample && sample[field] === undefined) sample[field] = performance.now();
    });
  }
}

export function transportStages(sample) {
  const ordered = ['start','created','sent','bodySent','headers','resolved','done'];
  if (ordered.some(key => !Number.isFinite(sample[key]))
      || ordered.some((key,i) => i && sample[key] < sample[ordered[i-1]])) return null;
  const elapsed = (a,b) => sample[b] - sample[a];
  return {
    clientCallToCreate: elapsed('start','created'),
    clientCreateToSend: elapsed('created','sent'),
    clientSend: elapsed('sent','bodySent'),
    clientAwaitHeaders: elapsed('bodySent','headers'),
    clientHeadersDelivery: elapsed('headers','resolved'),
    clientBodyConsume: elapsed('resolved','done'),
    clientTotal: elapsed('start','done'),
    ...(Number.isFinite(sample.wireDone) ? {
      clientBodyWire: elapsed('headers','wireDone'), clientAfterWire: elapsed('wireDone','done') } : {})
  };
}

export async function timedFetchText(url, options, enabled) {
  if (enabled) installDiagnostics();
  const sample = { start: performance.now() };
  const execute = async () => {
    const response = await fetch(url, options);
    sample.resolved = performance.now();
    const body = await response.text();
    sample.done = performance.now();
    return { response, body, ms: sample.done - sample.start,
      transport: enabled ? transportStages(sample) : null };
  };
  return enabled ? context.run(sample, execute) : execute();
}
