const jobs = document.getElementById('jobs'), notice = document.getElementById('notice');
const messages = { INVALID_URL: 'Enter a valid 1688 product link.', ACQUISITION_NOT_CONFIGURED: 'Connect an authorized product-data service before importing.', TRANSLATION_NOT_CONFIGURED: 'Configure the translation service and model.', EXCHANGE_RATE_REQUIRED: 'Set a current USD-per-CNY exchange rate, date, and source.', NO_SAFE_IMAGES: 'No images passed inspection. Check the image service and source photos.', AMBIGUOUS_PRICE: 'The source price does not identify a single sellable unit.', DUPLICATE_PRODUCT: 'This product appears to be in the catalog already.', IMAGE_REVIEW: 'An image or its English translation needs review.' };
async function api(url, body) {
  const response = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(messages[data.error] || 'The request could not be completed. Check the configuration and retry.'); return data;
}
function element(tag, text, parent) { const el = document.createElement(tag); if (text) el.textContent = text; parent.append(el); return el; }
let snapshot = '';
async function refresh() {
  try {
    const list = await api('/api/jobs'), next = JSON.stringify(list); if (next === snapshot) return; snapshot = next; jobs.replaceChildren();
    for (const job of list.reverse()) {
      const card = element('article', '', jobs); element('h3', job.product?.name || 'Product import', card); element('p', job.status, card);
      if (job.error) element('p', messages[job.error] || 'This import needs attention. Check the source data or service configuration, then retry.', card);
      if (job.product) {
        const p = job.product; element('p', `${p.top_category} · $${p.price.toFixed(2)} USD`, card); element('p', p.description, card);
        element('pre', [...p.features, ...Object.entries(p.specifications).map(([k,v]) => `${k}: ${v}`), ...p.packageContents].join('\n'), card);
        p.variants.forEach(v => element('p', `${v.options.map(o => o.name + ': ' + o.value).join(' / ')} · $${v.price.toFixed(2)}`, card));
        p.images.forEach((im, i) => { const img = element('img', '', card); img.src = `/api/images/${job.id}/${i + 1}`; img.alt = im.alt; });
      }
      if (job.status === 'READY' || ['FAILED','NEEDS REVIEW'].includes(job.status)) {
        const action = job.status === 'READY' ? 'publish' : 'retry';
        const button = element('button', action === 'publish' ? 'Approve & Export to Catalog' : 'Retry Import', card);
        button.onclick = async () => { button.disabled = true; try { await api(`/api/jobs/${job.id}/${action}`, {}); notice.textContent = action === 'publish' ? 'Exported. Run the catalog build, review the changes, then deploy through GitHub.' : 'Retry queued.'; await refresh(); } catch (e) { notice.textContent = e.message; button.disabled = false; } };
      }
    }
  } catch (e) { notice.textContent = e.message; }
}
document.getElementById('import').onsubmit = async e => { e.preventDefault(); const button = e.target.querySelector('button'); button.disabled = true; try { await api('/api/import', { url: document.getElementById('url').value }); notice.textContent = 'Import submitted. Status updates appear below.'; await refresh(); } catch (err) { notice.textContent = err.message; } finally { button.disabled = false; } };
refresh(); setInterval(refresh, 2000);
