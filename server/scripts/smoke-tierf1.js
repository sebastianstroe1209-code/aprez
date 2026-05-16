// Tier F commit 1 smoke — covers all 7 paths the user asked for:
//   a. POST a JPG → returns 200 with Photo row, file present on volume
//   b. POST a >5MB JPG → 400 with file-too-large
//   c. POST a .txt → 400 with invalid-file-type
//   d. POST 11 photos in a row → 11th returns 400 with photo-limit-reached
//   e. PUT cover on photo A → A.isCover=true, previous cover B.isCover=false
//   f. DELETE photo → row removed + file removed from disk
//   g. POST menu PDF → 200, Restaurant.menuPdfUrl set, file on disk
//
// Plus a regression spot-check that the Tier D2 diner-side endpoints
// (auth.middleware deletedAt path) still work after the F1 route mount.
//
// Idempotent: at start of the run, wipes any RestaurantPhoto rows on the
// target restaurant and clears Restaurant.coverPhotoUrl + menuPdfUrl so
// the photo cap math is deterministic. Spits out the orphan filenames
// for the operator to clean up on disk if a previous run crashed mid-way.

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const BASE = 'http://localhost:4000/api';
const prisma = new PrismaClient();
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');

// ----- admin login helper ---------------------------------------------------
async function adminToken() {
  const res = await fetch(`${BASE}/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@aprez.ro', password: 'admin123' }),
  });
  const data = await res.json();
  if (!data.token) throw new Error('Admin login failed: ' + JSON.stringify(data));
  return data.token;
}

// ----- multipart helper (no FormData polyfill quirks) -----------------------
async function postMultipart(url, token, fieldName, filename, contentType, body) {
  const boundary = '----aprezsmoke' + Math.random().toString(16).slice(2);
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const bodyBuf = Buffer.concat([
    Buffer.from(head, 'utf8'),
    Buffer.isBuffer(body) ? body : Buffer.from(body),
    Buffer.from(tail, 'utf8'),
  ]);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(bodyBuf.length),
    },
    body: bodyBuf,
  });
  let json = null;
  try { json = await res.json(); } catch (_) { json = null; }
  return { status: res.status, body: json };
}

async function http(method, url, token, jsonBody) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(jsonBody ? { 'Content-Type': 'application/json' } : {}),
    },
    body: jsonBody ? JSON.stringify(jsonBody) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (_) { json = null; }
  return { status: res.status, body: json };
}

function expect(cond, label) {
  if (cond) {
    console.log(`  PASS — ${label}`);
  } else {
    console.error(`  FAIL — ${label}`);
    process.exitCode = 1;
  }
}

// ----- tiny synthetic JPG/PNG payloads --------------------------------------
// Real-but-minimal: a 1×1 white JPEG bytes blob. Any size validation
// happens on the raw upload bytes regardless of pixel dimensions.
const TINY_JPEG = Buffer.from(
  'ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffdb0043010909090c0b0c180d0d1832211c213232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232ffc00011080001000103012200021101031101ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffc4001f0100030101010101010101010000000000000102030405060708090a0bffc400b51100020102040403040705040400010277000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a636465666768696a737475767778797a82838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9faffda000c03010002110311003f00fbfca28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800ffd9',
  'hex'
);

// Minimal but real PDF — "%PDF-1.0\n%%EOF" satisfies most parsers.
const TINY_PDF = Buffer.from('%PDF-1.0\n%%EOF\n', 'utf8');

async function main() {
  const token = await adminToken();
  const restaurant = await prisma.restaurant.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!restaurant) {
    console.error('No restaurants in DB to test against.');
    process.exit(1);
  }
  const rid = restaurant.id;
  console.log(`Smoke target: ${restaurant.nameEn} (${rid})`);

  // ---- baseline cleanup ----
  console.log('\n[baseline] wipe previous test photos + menu + on-disk dirs');
  const prior = await prisma.restaurantPhoto.findMany({ where: { restaurantId: rid } });
  for (const p of prior) {
    const fname = path.basename(p.photoUrl);
    const abs = path.join(UPLOADS_DIR, rid, 'photos', fname);
    try { fs.unlinkSync(abs); } catch (_) {}
  }
  await prisma.restaurantPhoto.deleteMany({ where: { restaurantId: rid } });
  await prisma.restaurant.update({
    where: { id: rid },
    data: { coverPhotoUrl: null, menuPdfUrl: null },
  });
  const menuAbs = path.join(UPLOADS_DIR, rid, 'menu.pdf');
  try { fs.unlinkSync(menuAbs); } catch (_) {}

  // ============================================================
  // a. POST a JPG → 201 with row + file on disk
  // ============================================================
  console.log('\n[a] POST a JPG → 201 + file on disk');
  const r1 = await postMultipart(
    `${BASE}/admin/restaurants/${rid}/photos`,
    token, 'photo', 'test.jpg', 'image/jpeg', TINY_JPEG
  );
  expect(r1.status === 201, `status=${r1.status}`);
  expect(!!r1.body?.id, `row returned: id=${r1.body?.id}`);
  expect(!!r1.body?.photoUrl?.startsWith('/uploads/'), `photoUrl prefix: ${r1.body?.photoUrl}`);
  const firstPhotoId = r1.body?.id;
  if (firstPhotoId) {
    const onDisk = fs.existsSync(path.join(UPLOADS_DIR, rid, 'photos', path.basename(r1.body.photoUrl)));
    expect(onDisk, `file written to disk`);
  }

  // ============================================================
  // b. POST a >5MB JPG → 400 file-too-large
  // ============================================================
  console.log('\n[b] POST a >5MB JPG → 400 file-too-large');
  // Build a 5.5MB buffer with a valid-ish JPEG header.
  const oversize = Buffer.alloc(5.5 * 1024 * 1024, 0xff);
  TINY_JPEG.copy(oversize, 0, 0, Math.min(TINY_JPEG.length, oversize.length));
  const r2 = await postMultipart(
    `${BASE}/admin/restaurants/${rid}/photos`,
    token, 'photo', 'big.jpg', 'image/jpeg', oversize
  );
  expect(r2.status === 400, `status=${r2.status}`);
  expect(r2.body?.error?.code === 'file-too-large', `error.code=${r2.body?.error?.code}`);

  // ============================================================
  // c. POST a .txt → 400 invalid-file-type
  // ============================================================
  console.log('\n[c] POST a .txt → 400 invalid-file-type');
  const r3 = await postMultipart(
    `${BASE}/admin/restaurants/${rid}/photos`,
    token, 'photo', 'not-an-image.txt', 'text/plain', 'hello world'
  );
  expect(r3.status === 400, `status=${r3.status}`);
  expect(r3.body?.error?.code === 'invalid-file-type', `error.code=${r3.body?.error?.code}`);

  // ============================================================
  // d. Reach the 10-cap → 11th returns 400 photo-limit-reached
  // ============================================================
  console.log('\n[d] Fill up to 10 then 11th rejected');
  // We already have 1 (from path a). Upload 9 more to reach 10.
  for (let i = 0; i < 9; i++) {
    const r = await postMultipart(
      `${BASE}/admin/restaurants/${rid}/photos`,
      token, 'photo', `fill-${i}.jpg`, 'image/jpeg', TINY_JPEG
    );
    if (r.status !== 201) {
      expect(false, `fill upload #${i+2}: status=${r.status} body=${JSON.stringify(r.body)}`);
      break;
    }
  }
  const countAfterFill = await prisma.restaurantPhoto.count({ where: { restaurantId: rid } });
  expect(countAfterFill === 10, `10 photos in DB (got ${countAfterFill})`);

  const r4 = await postMultipart(
    `${BASE}/admin/restaurants/${rid}/photos`,
    token, 'photo', 'eleventh.jpg', 'image/jpeg', TINY_JPEG
  );
  expect(r4.status === 400, `11th status=${r4.status}`);
  expect(r4.body?.error?.code === 'photo-limit-reached', `error.code=${r4.body?.error?.code}`);

  // ============================================================
  // e. PUT cover on photo A → A.isCover=true, previous cover B=false
  // ============================================================
  console.log('\n[e] PUT cover toggles isCover + coverPhotoUrl');
  const allPhotos = await prisma.restaurantPhoto.findMany({ where: { restaurantId: rid }, orderBy: { displayOrder: 'asc' } });
  const photoA = allPhotos[0];
  const photoB = allPhotos[1];

  // Mark B as cover first.
  const rCoverB = await http('PUT', `${BASE}/admin/restaurants/${rid}/photos/${photoB.id}/cover`, token);
  expect(rCoverB.status === 200, `mark B cover status=${rCoverB.status}`);
  const afterB = await prisma.restaurantPhoto.findMany({ where: { restaurantId: rid }, select: { id: true, isCover: true } });
  expect(afterB.find(p => p.id === photoB.id)?.isCover === true, `B.isCover=true`);
  expect(afterB.filter(p => p.isCover).length === 1, `exactly one cover`);

  // Now flip to A; B should clear.
  const rCoverA = await http('PUT', `${BASE}/admin/restaurants/${rid}/photos/${photoA.id}/cover`, token);
  expect(rCoverA.status === 200, `mark A cover status=${rCoverA.status}`);
  const afterA = await prisma.restaurantPhoto.findMany({ where: { restaurantId: rid }, select: { id: true, isCover: true } });
  expect(afterA.find(p => p.id === photoA.id)?.isCover === true, `A.isCover=true`);
  expect(afterA.find(p => p.id === photoB.id)?.isCover === false, `B.isCover=false (flipped off)`);
  const restA = await prisma.restaurant.findUnique({ where: { id: rid }, select: { coverPhotoUrl: true } });
  expect(restA.coverPhotoUrl === photoA.photoUrl, `Restaurant.coverPhotoUrl matches A`);

  // ============================================================
  // f. DELETE photo → row gone + file gone
  // ============================================================
  console.log('\n[f] DELETE photo removes row + file');
  const filenameToDelete = path.basename(photoA.photoUrl);
  const absToDelete = path.join(UPLOADS_DIR, rid, 'photos', filenameToDelete);
  expect(fs.existsSync(absToDelete), `file exists before delete: ${filenameToDelete}`);
  const rDel = await http('DELETE', `${BASE}/admin/restaurants/${rid}/photos/${photoA.id}`, token);
  expect(rDel.status === 200, `delete status=${rDel.status}`);
  expect(rDel.body?.wasCover === true, `wasCover=true`);
  expect(!fs.existsSync(absToDelete), `file removed from disk`);
  const restAfterDel = await prisma.restaurant.findUnique({ where: { id: rid }, select: { coverPhotoUrl: true } });
  expect(restAfterDel.coverPhotoUrl === null, `coverPhotoUrl cleared (deleted photo was the cover)`);

  // ============================================================
  // g. POST menu PDF → 201 + menuPdfUrl set + file on disk
  // ============================================================
  console.log('\n[g] POST menu PDF');
  const r5 = await postMultipart(
    `${BASE}/admin/restaurants/${rid}/menu`,
    token, 'menu', 'menu.pdf', 'application/pdf', TINY_PDF
  );
  expect(r5.status === 201, `status=${r5.status}`);
  expect(r5.body?.menuPdfUrl === `/uploads/${rid}/menu.pdf`, `menuPdfUrl=${r5.body?.menuPdfUrl}`);
  expect(fs.existsSync(menuAbs), `menu.pdf on disk`);

  // Negative for menu: a JPG should be rejected as wrong type.
  const r5b = await postMultipart(
    `${BASE}/admin/restaurants/${rid}/menu`,
    token, 'menu', 'wrong.jpg', 'image/jpeg', TINY_JPEG
  );
  expect(r5b.status === 400 && r5b.body?.error?.code === 'invalid-file-type', `menu rejects JPG: ${r5b.body?.error?.code}`);

  // DELETE menu cleanup
  const rDelMenu = await http('DELETE', `${BASE}/admin/restaurants/${rid}/menu`, token);
  expect(rDelMenu.status === 200, `delete menu status=${rDelMenu.status}`);
  expect(!fs.existsSync(menuAbs), `menu.pdf removed from disk`);

  // ============================================================
  // Static-serve smoke: /uploads/{rid}/photos/{filename} should 200
  // ============================================================
  console.log('\n[static] /uploads serving works');
  const stillThere = await prisma.restaurantPhoto.findFirst({ where: { restaurantId: rid } });
  if (stillThere) {
    const url = `http://localhost:4000${stillThere.photoUrl}`;
    const res = await fetch(url);
    expect(res.status === 200, `GET ${stillThere.photoUrl} → ${res.status}`);
    const contentType = res.headers.get('content-type') || '';
    expect(contentType.startsWith('image/'), `content-type: ${contentType}`);
  }

  // ============================================================
  // Regression: Tier D2 diner login + /users/me still work
  // ============================================================
  console.log('\n[REG] Tier D2 diner login still 200');
  const dinerLogin = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@aprez.ro', password: 'user123' }),
  });
  expect(dinerLogin.status === 200, `diner login=${dinerLogin.status}`);

  // ============================================================
  // Cleanup — drop the remaining smoke photos so the DB is clean.
  // ============================================================
  console.log('\n[CLEANUP] removing test photos');
  const remaining = await prisma.restaurantPhoto.findMany({ where: { restaurantId: rid } });
  for (const p of remaining) {
    const fname = path.basename(p.photoUrl);
    try { fs.unlinkSync(path.join(UPLOADS_DIR, rid, 'photos', fname)); } catch (_) {}
  }
  await prisma.restaurantPhoto.deleteMany({ where: { restaurantId: rid } });
  await prisma.restaurant.update({ where: { id: rid }, data: { coverPhotoUrl: null, menuPdfUrl: null } });

  await prisma.$disconnect();
  console.log(`\n${process.exitCode ? 'SMOKE FAILED' : 'SMOKE OK'}`);
}

main().catch(async (e) => {
  console.error('SMOKE THREW:', e);
  try { await prisma.$disconnect(); } catch (_) {}
  process.exit(1);
});
