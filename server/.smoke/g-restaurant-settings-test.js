// Tier G commit 3 — restaurant Settings save + staff photo/menu uploads.
//
//   PUT /api/restaurant/settings:
//     [a] happy   — autoConfirmEnabled + descriptionRo → 200, row updated.
//     [b] unknown — body { name } → 400 unknown-field, row untouched.
//     [c] phone   — body { phone:'+1...' } → 400 invalid-phone-format.
//     [d] tenant  — forged restaurantId in body → 400 unknown-field; the
//                   targeted restaurant B is untouched (JWT-derived id
//                   means cross-tenant is structurally impossible).
//   Staff photo/menu:
//     [e] POST photo → 201.
//     [f] PUT cover  → 200.
//     [g] DELETE another restaurant's photo → 403 forbidden.
//     [h] PUT cover on another restaurant's photo → 403 forbidden.
//     [i] DELETE own photo → 200.
//     [j] POST menu → 201.
//     [k] DELETE menu → 200.
//
// Acts as the seeded `lamama` staff against La Mama; La Mama's mutated
// fields are captured up-front and restored via prisma at the end.
// Requires the backend running on :4000.

const { PrismaClient } = require('@prisma/client');

const BASE = 'http://localhost:4000/api';
const prisma = new PrismaClient();
const TAG = '[smoke-g-settings]';

let passed = 0, failed = 0;
function expect(cond, label) {
  if (cond) { console.log(`  PASS — ${label}`); passed++; }
  else { console.error(`  FAIL — ${label}`); failed++; process.exitCode = 1; }
}

async function staffToken() {
  const r = await fetch(`${BASE}/auth/restaurant/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'lamama', password: 'lamama123' }),
  });
  return (await r.json()).token;
}

async function httpJson(method, path, token, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, body: j };
}

async function httpUpload(path, token, field, bytes, filename, mime) {
  const form = new FormData();
  form.append(field, new Blob([bytes], { type: mime }), filename);
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, body: j };
}

async function main() {
  const token = await staffToken();
  expect(!!token, 'lamama login → token');
  const restaurant = await prisma.restaurant.findFirst({ where: { staff: { some: { username: 'lamama' } } } });
  const rid = restaurant.id;
  console.log(`Smoke target: ${restaurant.nameEn} (${rid})`);

  // Capture mutable state so we can restore La Mama afterwards.
  const orig = await prisma.restaurant.findUnique({
    where: { id: rid },
    select: { autoConfirmEnabled: true, descriptionRo: true, coverPhotoUrl: true, menuPdfUrl: true, nameEn: true },
  });
  const origCover = await prisma.restaurantPhoto.findFirst({ where: { restaurantId: rid, isCover: true } });

  // Throwaway restaurant B for the cross-tenant checks.
  const restaurantB = await prisma.restaurant.create({
    data: {
      nameRo: TAG, nameEn: TAG, cuisineTypes: ['Romanian'],
      address: 'Smoke fixture', latitude: 44.4, longitude: 26.1, phone: '+40700000000',
    },
  });
  const photoB = await prisma.restaurantPhoto.create({
    data: { restaurantId: restaurantB.id, photoUrl: `/uploads/${restaurantB.id}/photos/fake.jpg`, displayOrder: 0 },
  });

  let createdPhotoId = null;
  try {
    console.log('\n[a] PUT /settings happy — autoConfirmEnabled + descriptionRo');
    const flip = !orig.autoConfirmEnabled;
    const a = await httpJson('PUT', '/restaurant/settings', token, { autoConfirmEnabled: flip, descriptionRo: 'G3 smoke description' });
    expect(a.status === 200, `status=200 (got ${a.status})`);
    expect(a.body?.autoConfirmEnabled === flip, 'response carries the new autoConfirmEnabled');
    expect(a.body?.descriptionRo === 'G3 smoke description', 'response carries the new descriptionRo');
    const dbA = await prisma.restaurant.findUnique({ where: { id: rid }, select: { autoConfirmEnabled: true, descriptionRo: true } });
    expect(dbA.autoConfirmEnabled === flip && dbA.descriptionRo === 'G3 smoke description', 'DB row updated');

    console.log('\n[b] PUT /settings { name } → 400 unknown-field');
    const b = await httpJson('PUT', '/restaurant/settings', token, { name: 'Hacker Cafe' });
    expect(b.status === 400, `status=400 (got ${b.status})`);
    expect(b.body?.error?.code === 'unknown-field', `error.code=unknown-field (got ${b.body?.error?.code})`);
    expect(b.body?.error?.field === 'name', `error.field=name (got ${b.body?.error?.field})`);
    const dbB = await prisma.restaurant.findUnique({ where: { id: rid }, select: { nameEn: true } });
    expect(dbB.nameEn === orig.nameEn, 'restaurant row untouched by the rejected request');

    console.log('\n[c] PUT /settings { phone:"+1234567890" } → 400 invalid-phone-format');
    const c = await httpJson('PUT', '/restaurant/settings', token, { phone: '+1234567890' });
    expect(c.status === 400, `status=400 (got ${c.status})`);
    expect(c.body?.error?.code === 'invalid-phone-format', `error.code=invalid-phone-format (got ${c.body?.error?.code})`);

    console.log('\n[d] PUT /settings with forged restaurantId → 400 unknown-field, restaurant B untouched');
    const d = await httpJson('PUT', '/restaurant/settings', token, { restaurantId: restaurantB.id, autoConfirmEnabled: !restaurantB.autoConfirmEnabled });
    expect(d.status === 400, `status=400 (got ${d.status})`);
    expect(d.body?.error?.code === 'unknown-field', `error.code=unknown-field (got ${d.body?.error?.code})`);
    expect(d.body?.error?.field === 'restaurantId', `error.field=restaurantId (got ${d.body?.error?.field})`);
    const dbBafter = await prisma.restaurant.findUnique({ where: { id: restaurantB.id }, select: { autoConfirmEnabled: true } });
    expect(dbBafter.autoConfirmEnabled === restaurantB.autoConfirmEnabled, 'restaurant B autoConfirmEnabled unchanged');

    console.log('\n[e] POST /restaurant/photos → 201');
    const e = await httpUpload('/restaurant/photos', token, 'photo', Buffer.from('fake-jpeg-bytes'), 'test.jpg', 'image/jpeg');
    expect(e.status === 201, `status=201 (got ${e.status})`);
    expect(!!e.body?.id, 'photo row created');
    createdPhotoId = e.body?.id;

    console.log('\n[f] PUT /restaurant/photos/:id/cover → 200');
    const f = await httpJson('PUT', `/restaurant/photos/${createdPhotoId}/cover`, token, {});
    expect(f.status === 200, `status=200 (got ${f.status})`);

    console.log('\n[g] DELETE another restaurant’s photo → 403');
    const g = await httpJson('DELETE', `/restaurant/photos/${photoB.id}`, token);
    expect(g.status === 403, `status=403 (got ${g.status})`);
    expect(g.body?.error?.code === 'forbidden', `error.code=forbidden (got ${g.body?.error?.code})`);

    console.log('\n[h] PUT cover on another restaurant’s photo → 403');
    const h = await httpJson('PUT', `/restaurant/photos/${photoB.id}/cover`, token, {});
    expect(h.status === 403, `status=403 (got ${h.status})`);
    expect(h.body?.error?.code === 'forbidden', `error.code=forbidden (got ${h.body?.error?.code})`);

    console.log('\n[i] DELETE own photo → 200');
    const i = await httpJson('DELETE', `/restaurant/photos/${createdPhotoId}`, token);
    expect(i.status === 200, `status=200 (got ${i.status})`);
    createdPhotoId = null;

    console.log('\n[j] POST /restaurant/menu → 201');
    const j = await httpUpload('/restaurant/menu', token, 'menu', Buffer.from('%PDF-1.4 fake menu'), 'menu.pdf', 'application/pdf');
    expect(j.status === 201, `status=201 (got ${j.status})`);
    expect(!!j.body?.menuPdfUrl, 'menuPdfUrl set');

    console.log('\n[k] DELETE /restaurant/menu → 200');
    const k = await httpJson('DELETE', '/restaurant/menu', token);
    expect(k.status === 200, `status=200 (got ${k.status})`);
  } finally {
    console.log('\n[cleanup] restore La Mama + drop fixture restaurant B');
    if (createdPhotoId) await prisma.restaurantPhoto.delete({ where: { id: createdPhotoId } }).catch(() => {});
    await prisma.restaurant.update({
      where: { id: rid },
      data: {
        autoConfirmEnabled: orig.autoConfirmEnabled,
        descriptionRo: orig.descriptionRo,
        coverPhotoUrl: orig.coverPhotoUrl,
        menuPdfUrl: orig.menuPdfUrl,
      },
    });
    if (origCover) await prisma.restaurantPhoto.update({ where: { id: origCover.id }, data: { isCover: true } }).catch(() => {});
    await prisma.restaurant.delete({ where: { id: restaurantB.id } }).catch(() => {});
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('SMOKE ERROR', e);
  process.exitCode = 1;
  await prisma.$disconnect();
});
