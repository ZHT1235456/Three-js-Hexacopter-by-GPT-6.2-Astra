import * as THREE from 'three';

const TAU = 2 * Math.PI;
const UP = new THREE.Vector3(0, 1, 0);
const MOTOR_RADIUS = 0.45;
const BOOM_HEIGHT = 0.253;
const ownedParts = new WeakMap();

function group(parent, name, x = 0, y = 0, z = 0) {
  const node = new THREE.Group();
  node.name = name;
  node.position.set(x, y, z);
  parent.add(node);
  return node;
}

function surface(columns, rows, point, reverse = false) {
  const positions = [];
  const indices = [];
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      positions.push(...point(column / columns, row / rows));
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column;
      const b = a + 1;
      const d = a + columns + 1;
      const c = d + 1;
      if (reverse) indices.push(a, d, b, b, d, c);
      else indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// A seamless two-over, two-under weave. The bitmap is generated in memory.
function carbonWeave() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const over = (Math.floor(x / 16) + Math.floor(y / 16)) % 4 < 2;
      const across = over ? x : y;
      const along = over ? y : x;
      const crown = Math.sin(Math.PI * ((across % 16) + 0.5) / 16);
      const fibre = Math.cos(TAU * across / 4);
      const value = 34 + (over ? 6 : 0) + 8 * crown + 2 * fibre + Math.sin(TAU * along / 32);
      const offset = (y * size + x) * 4;
      data.set([value, value + 4, value + 6, 255], offset);
    }
  }
  const map = new THREE.DataTexture(data, size, size);
  map.name = 'Twill carbon';
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(8, 30);
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
}

function makeMaterials(weave) {
  function finish(name, color, metalness, roughness, extra = {}) {
    return new THREE.MeshStandardMaterial({ name, color, metalness, roughness, ...extra });
  }
  return {
    shell: finish('Graphite ceramic coat', 0x414951, 0.34, 0.40),
    hatch: finish('Graphite service cover', 0x373f46, 0.33, 0.43),
    belly: finish('Lower shell', 0x313a43, 0.35, 0.43),
    black: finish('Black anodised alloy', 0x242c33, 0.57, 0.34),
    carbon: finish('Carbon composite', 0xffffff, 0.18, 0.43, { map: weave }),
    rubber: finish('Moulded elastomer', 0x20252b, 0.03, 0.69),
    steel: finish('Brushed titanium', 0x8997a1, 0.78, 0.29),
    fastener: finish('Machined fastener', 0xffffff, 0.72, 0.34, { vertexColors: true }),
    rail: finish('Satin aluminium', 0x56636c, 0.65, 0.35),
    orange: finish('Orange nose paint', 0xf35b18, 0.08, 0.40),
    copper: finish('Stator windings', 0xa35428, 0.72, 0.32),
    blade: finish('Composite blade and tip paint', 0xffffff, 0.28, 0.37, { vertexColors: true }),
    optic: finish('Objective coating', 0x11293a, 0.36, 0.17),
    iris: finish('Optical black', 0x070a0e, 0.04, 0.77),
    glass: new THREE.MeshPhysicalMaterial({
      name: 'Optical glass', color: 0x304b64, metalness: 0.10, roughness: 0.08,
      clearcoat: 1, clearcoatRoughness: 0.06, transparent: true, opacity: 0.19, depthWrite: false,
    }),
  };
}

function roundedPlate(width, height, depth, radius) {
  const bevel = Math.min(height * 0.23, radius * 0.45);
  const perimeter = [];
  for (let corner = 0; corner < 4; corner++) {
    const cx = (corner < 2 ? 1 : -1) * (width / 2 - radius);
    const cz = (corner === 0 || corner === 3 ? 1 : -1) * (depth / 2 - radius);
    for (let i = 0; i <= 8; i++) {
      const angle = (corner + i / 8) * Math.PI / 2;
      perimeter.push([cx, cz, Math.sin(angle), Math.cos(angle)]);
    }
  }
  const levels = [{ y: -height / 2, ny: -1, radial: 0, cap: true }];
  for (const end of [-1, 1]) {
    for (let i = 0; i <= 4; i++) {
      const angle = (end < 0 ? i / 4 - 1 : i / 4) * Math.PI / 2;
      levels.push({ y: end * (height / 2 - bevel) + bevel * Math.sin(angle),
        ny: Math.sin(angle), radial: Math.cos(angle) });
    }
  }
  levels.push({ y: height / 2, ny: 1, radial: 0, cap: true });
  const normals = [];
  const geometry = surface(perimeter.length, levels.length - 1, (u, v) => {
    const [cx, cz, nx, nz] = perimeter[Math.round(u * perimeter.length) % perimeter.length];
    const level = levels[Math.round(v * (levels.length - 1))];
    normals.push(nx * level.radial, level.ny, nz * level.radial);
    if (level.cap) return [0, level.y, 0];
    const r = radius - bevel * (1 - level.radial);
    return [cx + r * nx, level.y, cz + r * nz];
  });
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

// The socket has six flats, an inner wall and a recessed floor.
function socketHead() {
  const rings = [[0.78, 0], [1, 0.13], [1, 0.32], [0.86, 0.48], [0.86, 0.48],
    [0.51, 0.48], [0.51, 0.48], [0.51, 0.14], [0.51, 0.14], [0, 0.14]];
  const metal = new THREE.Color(0x98a1a7);
  const recess = new THREE.Color(0x30373d);
  const colours = [];
  const geometry = surface(36, rings.length - 1, (u, v) => {
    const index = Math.round(v * (rings.length - 1));
    const [radius, y] = rings[index];
    const angle = u * TAU;
    const flat = (angle + Math.PI / 6) % (Math.PI / 3) - Math.PI / 6;
    const r = index >= 5 ? radius * Math.cos(Math.PI / 6) / Math.cos(flat) : radius;
    const shade = index >= 7 ? recess : metal;
    colours.push(shade.r, shade.g, shade.b);
    return [r * Math.sin(angle), y, r * Math.cos(angle)];
  });
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  return geometry;
}

// Geometry is shared within a model. Each factory call owns its GPU resources.
class Parts {
  constructor() {
    this.geometries = new Map();
    this.batches = [];
    const weave = carbonWeave();
    this.textures = [weave];
    this.materials = makeMaterials(weave);
  }

  geometry(key, build) {
    if (!this.geometries.has(key)) this.geometries.set(key, build());
    return this.geometries.get(key);
  }

  mesh(parent, name, geometry, finish, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(geometry, this.materials[finish]);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  plate(parent, name, finish, width, height, depth, corner, x, y, z) {
    const key = ['plate', width, height, depth, corner].join('/');
    return this.mesh(parent, name, this.geometry(key, () => roundedPlate(width, height, depth, corner)), finish, x, y, z);
  }

  turned(parent, name, finish, profile, x = 0, y = 0, z = 0) {
    const geometry = this.geometry('lathe/' + name, () => new THREE.LatheGeometry(
      profile.map(([r, h]) => new THREE.Vector2(r, h)), 48,
    ));
    return this.mesh(parent, name, geometry, finish, x, y, z);
  }

  rod(parent, name, finish, radius, from, to) {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const delta = b.clone().sub(a);
    const geometry = this.geometry('round tube', () => new THREE.CylinderGeometry(1, 1, 1, 32));
    const mesh = this.mesh(parent, name, geometry, finish);
    mesh.position.copy(a).lerp(b, 0.5);
    mesh.scale.set(radius, delta.length(), radius);
    mesh.quaternion.setFromUnitVectors(UP, delta.normalize());
    return mesh;
  }

  batch(parent, name, geometry, finish, transforms) {
    const mesh = new THREE.InstancedMesh(geometry, this.materials[finish], transforms.length);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    transforms.forEach((transform, index) => {
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.batches.push(mesh);
    parent.add(mesh);
    return mesh;
  }

  screws(parent, name, locations, radius) {
    const transforms = locations.map(([x, y, z]) => {
      const screw = new THREE.Object3D();
      screw.position.set(x, y, z);
      screw.scale.setScalar(radius);
      return screw;
    });
    return this.batch(parent, name, this.geometry('socket head', socketHead), 'fastener', transforms);
  }

  dispose() {
    this.batches.forEach(mesh => mesh.dispose());
    this.geometries.forEach(geometry => geometry.dispose());
    Object.values(this.materials).forEach(material => material.dispose());
    this.textures.forEach(texture => texture.dispose());
  }
}

// Each station describes the shell from tail to nose in metres:
// longitudinal position, half width, belt height, crown height, belly depth.
const HULL = [
  [-0.167, 0.030, 0.000, 0.012, 0.014], [-0.158, 0.068, 0.003, 0.027, 0.021],
  [-0.132, 0.102, 0.008, 0.042, 0.033], [-0.088, 0.124, 0.012, 0.051, 0.041],
  [-0.039, 0.134, 0.015, 0.054, 0.046], [0.016, 0.135, 0.014, 0.053, 0.047],
  [0.066, 0.128, 0.011, 0.047, 0.044], [0.109, 0.113, 0.006, 0.039, 0.038],
  [0.143, 0.088, -0.001, 0.030, 0.031], [0.168, 0.050, -0.006, 0.019, 0.022],
  [0.179, 0.006, -0.009, 0.004, 0.005],
];
const outline = new THREE.CatmullRomCurve3(HULL.map(p => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.42);
const depthProfile = new THREE.CatmullRomCurve3(HULL.map(p => new THREE.Vector3(p[3], p[4], 0)), false, 'catmullrom', 0.42);

function hullPoint(t, angle) {
  const { x: z, y: width, z: belt } = outline.getPoint(t);
  const depth = depthProfile.getPoint(t);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    Math.min(width, 0.135) * Math.sign(c) * Math.abs(c) ** 0.77,
    belt + Math.sign(s) * Math.abs(s) ** 0.78 * (s >= 0 ? depth.x : depth.y),
    z,
  ];
}

function deckPoint(t, across, lift) {
  const angle = Math.acos(Math.sign(across) * Math.abs(across) ** (1 / 0.77));
  const [x, y, z] = hullPoint(t, angle);
  return [x, y + lift, z];
}

// Compartments share their edge samples. The painted areas are faces of the
// shell itself, so the pinstripe and chevron also share its surface normals.
const SHELL_PANELS = [
  ['upper-shell', 'shell', 0.035, Math.PI - 0.035, 64],
  ['starboard-gasket', 'rubber', Math.PI - 0.035, Math.PI + 0.035, 4],
  ['lower-shell', 'belly', Math.PI + 0.035, TAU - 0.035, 64],
  ['port-gasket', 'rubber', TAU - 0.035, TAU + 0.035, 4],
];
const PAINT_BANDS = [
  { rows: 40, material: 0, end: edge => edge - 0.017 },
  { rows: 1, material: 1, end: edge => edge - 0.008 },
  { rows: 1, material: 0, end: edge => edge },
  { rows: 4, material: 2, end: edge => edge + 0.066 },
  { rows: 20, material: 0, end: () => 1 },
];

function shellPanel(start, end, columns, painted) {
  const rows = PAINT_BANDS.reduce((sum, band) => sum + band.rows, 0);
  const tracks = Array.from({ length: columns + 1 }, (_, i) => {
    const angle = THREE.MathUtils.lerp(start, end, i / columns);
    const edge = 0.680 + 0.130 * (1 - Math.abs(Math.cos(angle)) ** 0.77);
    const stations = [0];
    let t = 0;
    for (const band of PAINT_BANDS) {
      const next = band.end(edge);
      for (let j = 1; j <= band.rows; j++) stations.push(THREE.MathUtils.lerp(t, next, j / band.rows));
      t = next;
    }
    return { angle, stations };
  });
  const geometry = surface(columns, rows, (u, v) => {
    const { angle, stations } = tracks[Math.round(u * columns)];
    return hullPoint(stations[Math.round(v * rows)], angle);
  });
  if (painted) {
    let offset = 0;
    for (const band of PAINT_BANDS) {
      const count = band.rows * columns * 6;
      geometry.addGroup(offset, count, band.material);
      offset += count;
    }
  }
  return geometry;
}

function buildFuselage(parts, root) {
  const body = group(root, 'fuselage', 0, BOOM_HEIGHT, 0);
  for (const [name, finish, start, end, columns] of SHELL_PANELS) {
    const painted = name === 'upper-shell';
    const geometry = parts.geometry(name, () => shellPanel(start, end, columns, painted));
    const panel = parts.mesh(body, name, geometry, finish);
    if (painted) panel.material = [parts.materials.shell, parts.materials.steel, parts.materials.orange];
  }
  for (const end of [0, 1]) {
    const name = end ? 'nose-endcap' : 'tail-endcap';
    const geometry = parts.geometry(name, () => {
      const points = SHELL_PANELS.flatMap(([, , a, b, columns]) =>
        Array.from({ length: columns }, (_, i) => {
          const [x, y] = hullPoint(end, THREE.MathUtils.lerp(a, b, i / columns));
          return new THREE.Vector2(x, y);
        }));
      const cap = new THREE.ShapeGeometry(new THREE.Shape(points));
      if (!end) {
        // ShapeGeometry faces +Z. The outward normal at the tail points to -Z.
        cap.setIndex(Array.from(cap.index.array).reverse());
        cap.computeVertexNormals();
      }
      return cap.translate(0, 0, outline.getPoint(end).x);
    });
    parts.mesh(body, name, geometry, 'belly');
  }

  function patch(name, finish, map, lift, columns = 24, rows = 24) {
    const geometry = parts.geometry(name, () => surface(columns, rows, (u, v) => {
      const [t, across] = map(u, v);
      return deckPoint(t, across, lift);
    }, true));
    return parts.mesh(body, name, geometry, finish);
  }
  function hatchMap(u, v, margin) {
    const t = 0.227 - margin + v * (0.407 + 2 * margin);
    const clipped = Math.max(0, 1 - Math.min(v, 1 - v) / 0.13);
    return [t, (2 * u - 1) * (0.495 + margin - 0.108 * clipped)];
  }
  patch('service-cover-seal', 'rubber', (u, v) => hatchMap(u, v, 0.007), 0.0009);
  patch('service-cover', 'hatch', (u, v) => hatchMap(u, v, 0), 0.0018);
  parts.screws(body, 'cover-fasteners', [0.267, 0.590].flatMap(t =>
    [-0.393, 0.393].map(s => deckPoint(t, s, 0.0019))), 0.0024);

  for (const side of [-1, 1]) {
    const intake = (u, v) => [0.208 + 0.175 * v, side * (0.678 + 0.182 * u)];
    // Increasing u must always run from port to starboard for outward normals.
    const map = (u, v) => intake(side > 0 ? u : 1 - u, v);
    patch('intake-well-' + side, 'rubber', map, 0.0008, 8, 12);
    for (let i = 0; i < 6; i++) {
      const z = 0.07 + i * 0.15;
      patch('intake-louvre-' + side + '-' + i, 'rail',
        (u, v) => map(0.08 + 0.84 * u, z + 0.038 * v), 0.00155, 6, 2);
    }
  }
}

function radialTransforms(count, radius, y) {
  return Array.from({ length: count }, (_, i) => {
    const angle = i * TAU / count;
    const item = new THREE.Object3D();
    item.position.set(radius * Math.sin(angle), y, radius * Math.cos(angle));
    item.rotation.y = angle;
    return item;
  });
}

function ventedEndplate() {
  const face = new THREE.Shape();
  face.moveTo(0.0263, 0);
  for (let i = 1; i <= 96; i++) {
    const angle = i * TAU / 96;
    face.lineTo(0.0263 * Math.cos(angle), 0.0263 * Math.sin(angle));
  }
  for (let i = 0; i < 10; i++) {
    const angle = i * TAU / 10;
    const slot = new THREE.Path();
    slot.absellipse(0.0178 * Math.cos(angle), 0.0178 * Math.sin(angle),
      0.0061, 0.00235, 0, TAU, true, angle + 0.46);
    face.holes.push(slot);
  }
  const plate = new THREE.ExtrudeGeometry(face, {
    depth: 0.0021, curveSegments: 14, bevelSegments: 2, bevelSize: 0.00022, bevelThickness: 0.0003,
  });
  return plate.rotateX(-Math.PI / 2);
}

// Span, chord, sweep, twist in degrees, and the factory tip-marking colour.
const BLADE = [
  [0.008, 0.011, 0.000, 25, 0], [0.019, 0.016, -0.0008, 24, 0],
  [0.038, 0.028, -0.001, 21, 0], [0.068, 0.032, 0.0016, 17, 0],
  [0.106, 0.027, 0.0070, 13, 0], [0.142, 0.0206, 0.0145, 10, 0],
  [0.1554, 0.0177, 0.0180, 8.5, 0], [0.1556, 0.0176, 0.0181, 8.5, 1],
  [0.1580, 0.0170, 0.0188, 8.3, 1], [0.1582, 0.0169, 0.0189, 8.3, 0],
  [0.1617, 0.0161, 0.0199, 8, 0], [0.1619, 0.0161, 0.0200, 8, 1],
  [0.1680, 0.0146, 0.0219, 7.4, 1], [0.1682, 0.0145, 0.0220, 7.4, 0],
  [0.1770, 0.0115, 0.0250, 6.4, 0], [0.1815, 0.0068, 0.0272, 5.5, 0],
  [0.1830, 0.0000, 0.0283, 5.3, 0],
];

function bladeGeometry(hand) {
  const sides = 32;
  const geometry = surface(sides, BLADE.length - 1, (u, v) => {
    const [r, chord, sweep, degrees] = BLADE[Math.round(v * (BLADE.length - 1))];
    const phi = u * TAU;
    const fraction = (1 - Math.cos(phi)) / 2;
    const across = (fraction - 0.43) * chord;
    const camber = 0.041 * chord * 4 * fraction * (1 - fraction);
    const thickness = 0.087 * chord * Math.sin(phi) * (1 - 0.72 * fraction);
    const twist = THREE.MathUtils.degToRad(degrees);
    const y = camber + thickness - across * Math.sin(twist) + 0.0022 * (r / 0.183) ** 2;
    return [r, y, hand * (sweep + across * Math.cos(twist))];
  }, hand < 0);
  const colours = [new THREE.Color(0x323a42), new THREE.Color(0x95a1a5)];
  const values = [];
  const normal = geometry.getAttribute('normal');
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  BLADE.forEach((section, row) => {
    const colour = colours[section[4]];
    for (let i = 0; i <= sides; i++) values.push(colour.r, colour.g, colour.b);
    const first = row * (sides + 1);
    a.fromBufferAttribute(normal, first);
    b.fromBufferAttribute(normal, first + sides);
    a.add(b).normalize();
    normal.setXYZ(first, a.x, a.y, a.z);
    normal.setXYZ(first + sides, a.x, a.y, a.z);
  });
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(values, 3));
  return geometry;
}

function buildMotor(parts, arm, number) {
  const motor = group(arm, 'motor-' + number, 0, 0.004, MOTOR_RADIUS);
  const rotor = group(motor, 'rotor-' + number, 0, 0.0385, 0);
  const bell = group(rotor, 'motor-bell', 0, -rotor.position.y, 0);
  parts.turned(motor, 'motor-foot', 'black', [
    [0, -0.012], [0.020, -0.012], [0.025, -0.009], [0.026, -0.005],
    [0.024, -0.002], [0.018, 0], [0.018, 0.009], [0, 0.009],
  ]);
  parts.turned(motor, 'stator', 'black', [
    [0, 0.005], [0.016, 0.005], [0.018, 0.008], [0.018, 0.023], [0.012, 0.026], [0, 0.026],
  ]);
  const winding = parts.geometry('wound copper', () => {
    const points = Array.from({ length: 81 }, (_, i) => {
      const t = i / 80;
      return new THREE.Vector3(0.00375 * Math.cos(TAU * 4 * t),
        0.0067 * Math.sin(TAU * 4 * t), 0.0068 * (t - 0.5));
    });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 80, 0.00072, 6, false);
  });
  parts.batch(motor, 'windings', winding, 'copper', radialTransforms(12, 0.0207, 0.0165));
  parts.turned(bell, 'bell-rim', 'black', [
    [0.020, 0.004], [0.025, 0.004], [0.027, 0.006], [0.027, 0.009],
    [0.025, 0.011], [0.0235, 0.011], [0.0235, 0.006], [0.020, 0.004],
  ]);
  const bridge = parts.geometry('bell bridge', () => roundedPlate(0.0058, 0.0168, 0.0026, 0.0009).rotateZ(-0.19));
  parts.batch(bell, 'cooling-port-bridges', bridge, 'black', radialTransforms(12, 0.025, 0.017));
  parts.turned(bell, 'upper-bell-rim', 'rail', [
    [0.0242, 0.023], [0.0262, 0.023], [0.0270, 0.0246], [0.0265, 0.0276],
    [0.0242, 0.028], [0.0242, 0.023],
  ]);
  parts.mesh(bell, 'vented-endplate', parts.geometry('vented endplate', ventedEndplate), 'rail', 0, 0.027, 0);
  parts.turned(bell, 'shaft-collar', 'black', [
    [0, 0.027], [0.012, 0.027], [0.012, 0.031], [0.008, 0.033], [0.006, 0.041], [0, 0.041],
  ]);

  const hand = number % 2 ? 1 : -1;
  rotor.userData.spinSign = hand;
  // Park the six props at different angles. The local +Y axis stays on the shaft.
  rotor.rotation.y = [0.17, 0.79, -0.45, 0.45, -0.19, -0.92][number - 1];
  const blade = parts.geometry('blade/' + hand, () => bladeGeometry(hand));
  parts.mesh(rotor, 'blade-a', blade, 'blade');
  parts.mesh(rotor, 'blade-b', blade, 'blade').rotation.y = Math.PI;
  parts.turned(rotor, 'prop-boss', 'black', [
    [0, -0.004], [0.012, -0.004], [0.014, -0.0015], [0.0135, 0.003],
    [0.0105, 0.005], [0.006, 0.0055], [0, 0.0055],
  ]);
  parts.screws(rotor, 'hub-bolt', [[0, 0.0052, 0]], 0.0048);
}

function buildArm(parts, root, number) {
  const arm = group(root, 'arm-' + number, 0, BOOM_HEIGHT, 0);
  arm.rotation.y = (number - 1) * Math.PI / 3 + Math.PI / 6;
  const tube = (name, finish, radius, a, b) => parts.rod(arm, name, finish, radius, [0, 0, a], [0, 0, b]);
  tube('carbon-boom', 'carbon', 0.012, 0.106, 0.429);
  const socket = group(arm, 'root-socket', 0, 0, 0.103);
  socket.rotation.x = Math.PI / 2;
  parts.turned(socket, 'cast-socket', 'hatch', [
    [0, 0], [0.021, 0], [0.021, 0.040], [0.0183, 0.048],
    [0.0183, 0.061], [0.015, 0.068], [0.012, 0.068], [0.012, 0], [0, 0],
  ]);
  tube('socket-band', 'rail', 0.0177, 0.160, 0.166);
  parts.plate(arm, 'clamp-ears', 'black', 0.046, 0.009, 0.022, 0.004, 0, 0.009, 0.146);
  parts.screws(arm, 'root-clamp-bolts', [[-0.017, 0.0134, 0.146], [0.017, 0.0134, 0.146]], 0.0030);
  tube('outboard-collar', 'black', 0.0146, 0.383, 0.419);
  tube('collar-retainer', 'rail', 0.0148, 0.385, 0.389);
  parts.plate(arm, 'motor-saddle', 'hatch', 0.057, 0.012, 0.082, 0.014, 0, -0.007, 0.433);
  parts.screws(arm, 'saddle-bolts', [[-0.019, -0.0011, 0.409], [0.019, -0.0011, 0.409]], 0.0024);
  buildMotor(parts, arm, number);
}

function buildLandingGear(parts, root) {
  const gear = group(root, 'landing-gear');
  const runner = parts.geometry('bent runner', () => {
    const route = [
      [0, 0.027, -0.172], [0, 0.015, -0.150], [0, 0.010, -0.123],
      [0, 0.010, -0.092], [0, 0.010, 0], [0, 0.010, 0.110],
      [0, 0.012, 0.143], [0, 0.022, 0.167], [0, 0.034, 0.183],
    ];
    const curve = new THREE.CatmullRomCurve3(route.map(p => new THREE.Vector3(...p)));
    return new THREE.TubeGeometry(curve, 48, 0.0064, 20, false);
  });
  for (const side of [-1, 1]) {
    const skid = group(gear, side > 0 ? 'port-skid' : 'starboard-skid');
    const x = side * 0.135;
    parts.mesh(skid, 'swept-runner', runner, 'rail', x, 0, 0);
    parts.rod(skid, 'front-end-plug', 'rubber', 0.0068, [x, 0.030, 0.178], [x, 0.0354, 0.185]);
    parts.rod(skid, 'rear-end-plug', 'rubber', 0.0068, [x, 0.024, -0.1665], [x, 0.028, -0.174]);
    for (const end of [-1, 1]) {
      const z = 0.102 * end;
      const brace = group(skid, end > 0 ? 'front-brace' : 'rear-brace');
      parts.rod(brace, 'contact-pad', 'rubber', 0.010, [x, 0.010, z - 0.019], [x, 0.010, z + 0.019]);
      parts.plate(brace, 'foot-clamp', 'black', 0.022, 0.017, 0.027, 0.005, x, 0.018, z);
      const foot = new THREE.Vector3(x, 0.021, z);
      const shoulder = new THREE.Vector3(side * 0.075, 0.222, end * 0.075);
      const onLeg = t => foot.clone().lerp(shoulder, t).toArray();
      parts.rod(brace, 'carbon-leg', 'carbon', 0.0078, onLeg(0), onLeg(1));
      parts.rod(brace, 'lower-ferrule', 'black', 0.0099, onLeg(0), onLeg(0.13));
      parts.rod(brace, 'upper-ferrule', 'hatch', 0.0107, onLeg(0.81), onLeg(1.02));
      parts.rod(brace, 'ferrule-band', 'rail', 0.0109, onLeg(0.82), onLeg(0.85));
      parts.plate(brace, 'hull-hardpoint', 'black', 0.037, 0.016, 0.035, 0.007,
        shoulder.x, shoulder.y, shoulder.z);
    }
  }
}

function buildCamera(parts, pitch) {
  const camera = group(pitch, 'camera');
  parts.plate(camera, 'camera-body', 'hatch', 0.067, 0.053, 0.055, 0.012, 0, 0, -0.002);
  parts.plate(camera, 'camera-rear-cap', 'black', 0.060, 0.047, 0.010, 0.008, 0, 0, -0.027);
  const lens = group(camera, 'lens', 0, 0, 0.020);
  // The lathe is built on Y, then aimed along the aircraft's forward axis, +Z.
  lens.rotation.x = Math.PI / 2;
  parts.turned(lens, 'lens-barrel', 'black', [
    [0, 0], [0.027, 0], [0.027, 0.006], [0.024, 0.009], [0.024, 0.016],
    [0.0256, 0.018], [0.0256, 0.028], [0.0244, 0.030],
    [0.0197, 0.030], [0.0185, 0.025], [0.0185, 0.010], [0, 0.010],
  ]);
  const grip = parts.geometry('lens knurl', () => new THREE.BoxGeometry(0.0013, 0.009, 0.0013));
  parts.batch(lens, 'focus-ring-knurl', grip, 'rail', radialTransforms(40, 0.02545, 0.0227));
  parts.turned(lens, 'retaining-ring', 'steel', [
    [0.0184, 0.0265], [0.0199, 0.0265], [0.0202, 0.0287],
    [0.0195, 0.0294], [0.0185, 0.0294], [0.0181, 0.0286], [0.0184, 0.0265],
  ]);
  parts.turned(lens, 'objective', 'optic', [
    [0, 0.020], [0.0183, 0.020], [0.0183, 0.0240], [0.015, 0.0254],
    [0.011, 0.0261], [0.0077, 0.0264], [0.0077, 0.0230], [0, 0.0230],
  ]);
  parts.rod(lens, 'iris', 'iris', 0.0076, [0, 0.0224, 0], [0, 0.0234, 0]);
  const dome = parts.mesh(lens, 'front-element',
    parts.geometry('optical dome', () => new THREE.SphereGeometry(1, 48, 16, 0, TAU, 0, Math.PI / 2)),
    'glass', 0, 0.0265, 0);
  dome.scale.set(0.0183, 0.0023, 0.0183);
  dome.castShadow = false;
}

function buildGimbal(parts, root, referenceEdition) {
  const mount = group(root, 'gimbal', 0, 0.215, 0.055);
  parts.plate(mount, 'upper-isolator-plate', 'black', 0.093, 0.008, 0.071, 0.011, 0, 0.001, 0);
  parts.plate(mount, 'lower-isolator-plate', 'hatch', 0.089, 0.005, 0.068, 0.009, 0, -0.022, 0);
  for (const x of [-0.033, 0.033]) {
    for (const z of [-0.023, 0.023]) {
      parts.turned(mount, 'isolation-ball', 'rubber', [
        [0, -0.021], [0.006, -0.021], [0.006, -0.0185], [0.0082, -0.016],
        [0.0093, -0.012], [0.0083, -0.008], [0.0056, -0.006],
        [0.0055, -0.0032], [0.0068, -0.0032], [0.0068, -0.002], [0, -0.002],
      ], x, 0, z);
    }
  }
  parts.turned(mount, 'yaw-bearing', 'black', [
    [0, -0.037], [0.019, -0.037], [0.0225, -0.034], [0.0225, -0.027],
    [0.018, -0.024], [0, -0.024],
  ]);
  const yaw = group(mount, 'gimbal-yaw', 0, -0.037, 0);
  if (referenceEdition) {
    buildReferenceGimbalHead(parts, yaw);
    return;
  }
  parts.plate(yaw, 'yoke-bridge', 'rail', 0.088, 0.010, 0.022, 0.006, 0, -0.003, -0.005);
  for (const side of [-1, 1]) {
    const x = side * 0.039;
    parts.plate(yaw, 'yoke-cheek', 'rail', 0.008, 0.052, 0.019, 0.0035, x, -0.025, -0.005);
    const pin = group(yaw, 'pitch-bearing', x, -0.047, 0);
    pin.rotation.z = -side * Math.PI / 2;
    parts.turned(pin, 'trunnion', 'black', [
      [0, -0.006], [0.011, -0.006], [0.0145, -0.003], [0.0145, 0.005],
      [0.0125, 0.008], [0.009, 0.008], [0.008, 0.0088], [0, 0.0088],
    ]);
    parts.screws(pin, 'bearing-fasteners', [[0, 0.0087, 0]], 0.0033);
  }
  const pitch = group(yaw, 'gimbal-pitch', 0, -0.047, 0);
  buildCamera(parts, pitch);
}

// Second edition. The grain and machining marks are generated at physical
// scale. R stores surface height and G stores roughness for the two PBR maps.
function finishTexture(name, { brushed = false, albedo = false } = {}) {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  let seed = 0x61ac0;
  function noise() {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  for (let y = 0; y < size; y++) {
    const line = noise() - 0.5;
    for (let x = 0; x < size; x++) {
      const grain = noise() - 0.5;
      const offset = (y * size + x) * 4;
      if (albedo) {
        const grey = 225 + 48 * grain;
        data.set([grey, grey, grey, 255], offset);
      } else {
        const relief = brushed ? 0.82 * line + 0.18 * grain : grain;
        data.set([128 + 118 * relief, 214 + 62 * relief, 255, 255], offset);
      }
    }
  }
  const map = new THREE.DataTexture(data, size, size);
  map.name = name;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
}

function addReferenceFinishes(parts) {
  const polymer = finishTexture('Mould grain');
  const speckle = finishTexture('Polymer speckle', { albedo: true });
  const metal = finishTexture('Machining lines', { brushed: true });
  parts.textures.push(polymer, speckle, metal);
  const finish = (name, color, metalness, roughness, options = {}) =>
    new THREE.MeshStandardMaterial({ name, color, metalness, roughness, ...options });
  Object.assign(parts.materials, {
    mould: finish('Grained graphite polymer', 0x505154, 0.11, 0.51,
      { map: speckle, roughnessMap: polymer, bumpMap: polymer, bumpScale: 0.00023 }),
    rim: finish('Dark moulded skirt', 0x353536, 0.07, 0.54),
    inlay: finish('Burnt orange inlay', 0xda681f, 0.40, 0.36),
    vanes: finish('Black vent vanes', 0x333435, 0.22, 0.40),
    brushed: finish('Brushed natural aluminium', 0xb9b7b1, 0.81, 0.38,
      { roughnessMap: metal, bumpMap: metal, bumpScale: 0.000035 }),
    toolBlack: finish('Black oxide hardware', 0x514e49, 0.65, 0.36, { vertexColors: true }),
    cameraCast: finish('Die-cast camera housing', 0x343538, 0.38, 0.43,
      { roughnessMap: polymer, bumpMap: polymer, bumpScale: 0.000095 }),
    lensMetal: finish('Fine black lens barrel', 0x29292c, 0.57, 0.36),
    flex: finish('Amber flexible circuit', 0x99581e, 0.24, 0.42),
    traces: finish('Etched copper traces', 0xcf8e42, 0.60, 0.35),
    coatedLens: new THREE.MeshPhysicalMaterial({
      name: 'Multicoated objective', color: 0xc2cbd7, vertexColors: true, metalness: 0.42,
      roughness: 0.10, clearcoat: 1, clearcoatRoughness: 0.055,
      iridescence: 0.70, iridescenceIOR: 1.39, iridescenceThicknessRange: [210, 390],
    }),
  });
  const frontCoating = parts.materials.coatedLens.clone();
  frontCoating.name = 'Translucent front coating';
  frontCoating.transparent = true;
  frontCoating.opacity = 0.49;
  frontCoating.depthWrite = false;
  parts.materials.frontCoating = frontCoating;
}

// Clockwise contours are drawn in X, Z. Positive Z is the nose.
function housingOutline() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.187);
  shape.bezierCurveTo(0.025, 0.187, 0.033, 0.174, 0.051, 0.155);
  shape.bezierCurveTo(0.093, 0.110, 0.135, 0.052, 0.135, -0.003);
  shape.bezierCurveTo(0.135, -0.064, 0.124, -0.126, 0.095, -0.153);
  shape.bezierCurveTo(0.075, -0.173, 0.040, -0.178, 0, -0.178);
  shape.bezierCurveTo(-0.040, -0.178, -0.075, -0.173, -0.095, -0.153);
  shape.bezierCurveTo(-0.124, -0.126, -0.135, -0.064, -0.135, -0.003);
  shape.bezierCurveTo(-0.135, 0.052, -0.093, 0.110, -0.051, 0.155);
  shape.bezierCurveTo(-0.033, 0.174, -0.025, 0.187, 0, 0.187);
  return shape.getPoints(18).slice(0, -1);
}

function roundPlan(width, length, radius, samples = 80) {
  const x = width / 2, z = length / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-x + radius, z);
  shape.lineTo(x - radius, z);
  shape.quadraticCurveTo(x, z, x, z - radius);
  shape.lineTo(x, -z + radius);
  shape.quadraticCurveTo(x, -z, x - radius, -z);
  shape.lineTo(-x + radius, -z);
  shape.quadraticCurveTo(-x, -z, -x, -z + radius);
  shape.lineTo(-x, z - radius);
  shape.quadraticCurveTo(-x, z, -x + radius, z);
  return shape.getSpacedPoints(samples).slice(0, -1);
}

function deckHeight(x, z) {
  const crown = Math.hypot(x, 0.018) - 0.018;
  const shoulder = Math.max(0, Math.abs(x) - 0.068);
  return 0.051 - 0.087 * crown - 2.8 * shoulder ** 2 - 0.68 * (z + 0.025) ** 2 - 0.040 * z;
}

function raisedCoverHeight(x, z) {
  const crown = Math.max(0, 1 - (x / 0.078) ** 2);
  return deckHeight(x, z) + 0.010 + 0.010 * crown - 0.20 * (z + 0.035) ** 2;
}

// Triangulate the actual openings. Subdividing the cap before lifting it to its
// curved height field preserves the moulded crown around the holes.
function panelFace(outline, holes, height, subdivisions = 0, upward = true) {
  const vertices = [...outline, ...holes.flat()];
  let faces = THREE.ShapeUtils.triangulateShape(outline, holes);
  for (let level = 0; level < subdivisions; level++) {
    const midpoints = new Map();
    function midpoint(a, b) {
      const key = Math.min(a, b) + '/' + Math.max(a, b);
      if (!midpoints.has(key)) {
        midpoints.set(key, vertices.length);
        vertices.push(vertices[a].clone().lerp(vertices[b], 0.5));
      }
      return midpoints.get(key);
    }
    faces = faces.flatMap(([a, b, c]) => {
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      return [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]];
    });
  }
  const positions = [], normals = [], uv = [];
  const delta = 0.00002;
  for (const {x, y: z} of vertices) {
    positions.push(x, height(x, z), z);
    const dx = (height(x + delta, z) - height(x - delta, z)) / (2 * delta);
    const dz = (height(x, z + delta) - height(x, z - delta)) / (2 * delta);
    const normal = new THREE.Vector3(-dx, 1, -dz).normalize();
    if (!upward) normal.negate();
    normals.push(normal.x, normal.y, normal.z);
    uv.push(x * 32, z * 32);
  }
  const indices = [];
  for (const [a, b, c] of faces) {
    const p = vertices[a], q = vertices[b], r = vertices[c];
    const ccw = (q.x - p.x) * (r.y - p.y) > (q.y - p.y) * (r.x - p.x);
    if (ccw === upward) indices.push(a, c, b);
    else indices.push(a, b, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  return geometry;
}

// Each row is a complete horizontal contour. Group indices by finish so the
// continuous nose inlay and the stepped seal share their edges with the shell.
function contourWall(rings, finishAt) {
  const columns = rings[0].length;
  const rows = rings.length - 1;
  const geometry = surface(columns, rows, (u, v) =>
    rings[Math.round(v * rows)][Math.round(u * columns) % columns]);
  const normals = geometry.getAttribute('normal');
  const startNormal = new THREE.Vector3(), endNormal = new THREE.Vector3();
  for (let row = 0; row <= rows; row++) {
    const first = row * (columns + 1), last = first + columns;
    startNormal.fromBufferAttribute(normals, first);
    endNormal.fromBufferAttribute(normals, last);
    const smooth = startNormal.add(endNormal).normalize();
    normals.setXYZ(first, smooth.x, smooth.y, smooth.z);
    normals.setXYZ(last, smooth.x, smooth.y, smooth.z);
  }
  const distances = [0];
  for (let i = 0; i < columns; i++) {
    const a = rings[0][i], b = rings[0][(i + 1) % columns];
    distances.push(distances[i] + Math.hypot(b[0] - a[0], b[2] - a[2]));
  }
  const uv = [];
  for (const ring of rings) {
    for (let col = 0; col <= columns; col++) uv.push(distances[col] * 32, ring[col % columns][1] * 32);
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (finishAt) {
    const indices = geometry.index.array;
    const groups = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const slot = finishAt(row, col);
        const groupIndices = groups[slot] ??= [];
        const start = (row * columns + col) * 6;
        for (let i = 0; i < 6; i++) groupIndices.push(indices[start + i]);
      }
    }
    let offset = 0;
    groups.forEach((list, index) => {
      geometry.addGroup(offset, list.length, index);
      offset += list.length;
    });
    geometry.setIndex(groups.flat());
  }
  return geometry;
}

function circlePlan(x, z, radius) {
  return Array.from({ length: 36 }, (_, i) => {
    const a = i * TAU / 36;
    return new THREE.Vector2(x + radius * Math.sin(a), z + radius * Math.cos(a));
  });
}

function intakePlan(side) {
  const ring = roundPlan(0.029, 0.14, 0.009).map(p => {
    const z = p.y - 0.040;
    const center = 0.092 - 1.20 * (z + 0.012) ** 2;
    return new THREE.Vector2(side * (center + p.x), z);
  });
  return side > 0 ? ring : ring.reverse();
}

function buildReferenceBody(parts, root) {
  const body = group(root, 'fuselage', 0, BOOM_HEIGHT, 0);
  const plan = housingOutline(), vents = [-1, 1].map(intakePlan);
  const deck = plan.map(p => p.clone().multiplyScalar(0.916));
  const skirt = plan.map(p => p.clone().multiplyScalar(0.82));
  // Bottom return, lower lip, squeezed gasket, side draft, inlay and top bevel.
  const levels = [
    [0.820, 0, -0.042], [0.870, 0, -0.040], [0.972, 0, -0.025], [0.990, 0, -0.020],
    [0.999, 0, -0.017], [1, 0, -0.0145], [0.995, 0, -0.013], [0.994, 0, -0.0107],
    [0.999, 0, -0.0098], [0.993, 0, -0.006], [0.970, 0.74, -0.001],
    [0.958, 1, -0.0062], [0.947, 1, -0.0056], [0.946, 1, -0.0054],
    [0.930, 1, -0.0030], [0.916, 1, 0],
  ];
  const walls = levels.map(([scale, fraction, offset], row) => plan.map(p => {
    const height = deckHeight(p.x * 0.916, p.y * 0.916);
    const taper = THREE.MathUtils.smootherstep(p.y, 0.021, 0.102);
    const bandScale = row === 12 ? 0.006 * taper : row === 13 ? -0.011 * taper : 0;
    const x = p.x * (scale + bandScale), z = p.y * (scale + bandScale);
    const band = row === 11 || row === 12 ? 0.0002 + 0.0048 * taper : 0;
    return [x, height * fraction + offset - band, z];
  }));
  const sidewall = parts.geometry('reference housing walls', () => contourWall(walls, (row, col) => {
    if (row <= 3) return 1;
    if (row <= 7) return 2;
    if (row === 12 && plan[col].y > 0.026) return 3;
    if ((row === 11 || row === 13) && plan[col].y > 0.026) return 1;
    return 0;
  }));
  const wall = parts.mesh(body, 'housing-sidewall', sidewall, 'mould');
  wall.material = [parts.materials.mould, parts.materials.rim, parts.materials.rubber, parts.materials.inlay];
  parts.mesh(body, 'upper-shell', parts.geometry('perforated deck',
    () => panelFace(deck, vents, deckHeight, 2)), 'mould');
  parts.mesh(body, 'lower-shell', parts.geometry('belly closure',
    () => panelFace(skirt, [], () => -0.042, 0, false)), 'rim');

  for (const [index, side] of [-1, 1].entries()) {
    const mouth = vents[index];
    const center = new THREE.Vector2(side * 0.091, -0.04);
    const throat = mouth.map(p => new THREE.Vector2(
      THREE.MathUtils.lerp(center.x, p.x, 0.90), THREE.MathUtils.lerp(center.y, p.y, 0.976)));
    const wallRings = [mouth, throat, throat].map((ring, i) =>
      ring.map(p => [p.x, deckHeight(p.x, p.y) - [0, 0.0017, 0.010][i], p.y]));
    parts.mesh(body, 'recessed-vent-rim', parts.geometry('vent throat/' + side,
      () => contourWall(wallRings)), 'rim');
    parts.mesh(body, 'vent-chamber', parts.geometry('vent floor/' + side,
      () => panelFace(throat, [], (x, z) => deckHeight(x, z) - 0.010)), 'iris');
    for (let i = 0; i < 8; i++) {
      const z = -0.096 + i * 0.016;
      const x = side * (0.092 - 1.20 * (z + 0.012) ** 2);
      const vane = parts.plate(body, 'intake-vane', 'vanes', 0.0275, 0.0032, 0.008, 0.0013,
        x, deckHeight(x, z) - 0.0042, z);
      vane.rotation.set(-0.38, -side * 0.065, -side * 0.105);
    }
  }

  const cover = roundPlan(0.150, 0.226, 0.024, 128).map(p => {
    const z = p.y - 0.032;
    return new THREE.Vector2(p.x * (1 - 0.14 * (p.y / 0.113) ** 2), z);
  });
  const holes = [-0.050, 0.050].flatMap(x => [-0.095, 0.058].map(z => circlePlan(x, z, 0.0049)));
  const rings = [[1.025, 0, 0.0002], [1.025, 0, 0.0014], [1.008, 0, 0.0020],
    [1.002, 0.60, 0], [0.983, 0.91, 0], [0.961, 1, 0]].map(([factor, lift, offset]) => cover.map(p => {
      const x = p.x * factor, z = (p.y + 0.032) * factor - 0.032;
      return [x, THREE.MathUtils.lerp(deckHeight(x, z), raisedCoverHeight(x, z), lift) + offset, z];
    }));
  const coverWall = parts.mesh(body, 'hatch-reveal', parts.geometry('hatch shoulder',
    () => contourWall(rings, row => row < 2 ? 1 : 0)), 'mould');
  coverWall.material = [parts.materials.mould, parts.materials.rubber];
  const top = rings[rings.length - 1].map(([x, , z]) => new THREE.Vector2(x, z));
  parts.mesh(body, 'service-cover', parts.geometry('recessed service cover',
    () => panelFace(top, holes, raisedCoverHeight, 2)), 'mould');
  const fasteners = [];
  for (const [i, hole] of holes.entries()) {
    const center = hole.reduce((sum, p) => sum.add(p), new THREE.Vector2()).multiplyScalar(1 / hole.length);
    const bottom = hole.map(p => center.clone().lerp(p, 0.78));
    const y = raisedCoverHeight(center.x, center.y) - 0.0021;
    const pocket = [hole.map(p => [p.x, raisedCoverHeight(p.x, p.y), p.y]),
      bottom.map(p => [p.x, y, p.y]), bottom.map(() => [center.x, y, center.y])];
    parts.mesh(body, 'countersink', parts.geometry('screw well/' + i, () => contourWall(pocket)), 'rim');
    fasteners.push([center.x, y, center.y]);
  }
  parts.screws(body, 'cover-fasteners', fasteners, 0.00345).material = parts.materials.toolBlack;
}

function finishUV(geometry) {
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
  const uv = [];
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const nx = Math.abs(normals.getX(i)), ny = Math.abs(normals.getY(i)), nz = Math.abs(normals.getZ(i));
    if (ny >= nx && ny >= nz) uv.push(x * 32, z * 32);
    else if (nx >= nz) uv.push(z * 32, y * 32);
    else uv.push(x * 32, y * 32);
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geometry;
}

function yokeGeometry() {
  // The lower bend sweeps back behind the lens to give it clearance when looking down.
  const s = new THREE.Shape();
  s.moveTo(-0.0455, 0.008);
  s.lineTo(-0.0455, -0.026);
  s.quadraticCurveTo(-0.0455, -0.046, -0.026, -0.046);
  s.lineTo(0.026, -0.046);
  s.quadraticCurveTo(0.0455, -0.046, 0.0455, -0.026);
  s.lineTo(0.0455, 0.008);
  s.quadraticCurveTo(0.0455, 0.012, 0.0425, 0.012);
  s.quadraticCurveTo(0.039, 0.012, 0.039, 0.008);
  s.lineTo(0.039, -0.025);
  s.quadraticCurveTo(0.039, -0.0395, 0.025, -0.0395);
  s.lineTo(-0.025, -0.0395);
  s.quadraticCurveTo(-0.039, -0.0395, -0.039, -0.025);
  s.lineTo(-0.039, 0.008);
  s.quadraticCurveTo(-0.039, 0.012, -0.0425, 0.012);
  s.quadraticCurveTo(-0.0455, 0.012, -0.0455, 0.008);
  const geometry = new THREE.ExtrudeGeometry(s, {
    depth: 0.019, bevelSize: 0.00055, bevelThickness: 0.00065, bevelSegments: 3, curveSegments: 18,
  });
  const p = geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    p.setZ(i, p.getZ(i) - 0.0095 + Math.min(0, p.getY(i) + 0.009) * 1.20);
  }
  geometry.computeVertexNormals();
  return finishUV(geometry);
}

function focusRing() {
  const profile = [[0.0302, 0.012], [0.0313, 0.013], [0.0316, 0.0145],
    [0.0316, 0.0305], [0.0313, 0.032], [0.0301, 0.033]];
  return surface(288, profile.length - 1, (u, v) => {
    const row = Math.round(v * (profile.length - 1));
    const [r, y] = profile[row], angle = u * TAU;
    const flute = row === 2 || row === 3 ? 0.00080 * (1 - Math.cos(72 * angle)) / 2 : 0;
    return [(r - flute) * Math.sin(angle), y, (r - flute) * Math.cos(angle)];
  });
}

function objectiveGeometry(outer, inner, rimHeight, sag, shift) {
  const cols = 80, rows = 28;
  const colors = [];
  const blue = new THREE.Color(0x246b9e), violet = new THREE.Color(0x674883);
  const dark = new THREE.Color(0x0c1522), tint = new THREE.Color();
  const geometry = surface(cols, rows, (u, v) => {
    const r = THREE.MathUtils.lerp(outer, inner, v), angle = u * TAU;
    // The anti-reflection coating is tinted. The highlights themselves are
    // produced by the environment on the curved glass and change with the camera.
    tint.copy(blue).lerp(violet, 0.48 + 0.42 * Math.cos(2 * angle + 1.8 * v + shift));
    const coating = 0.23 + 0.61 * Math.sin(v * Math.PI) ** 1.3;
    tint.lerp(dark, 1 - coating);
    colors.push(tint.r, tint.g, tint.b);
    const y = rimHeight + sag * (1 - (r / outer) ** 2);
    return [r * Math.sin(angle), y, r * Math.cos(angle)];
  });
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function cameraRibbon(parts, camera) {
  const curve = new THREE.CatmullRomCurve3([
    [0.009, 0.017, -0.032], [0.009, 0.026, -0.040], [0.013, 0.032, -0.047],
    [0.024, 0.026, -0.046], [0.031, 0.009, -0.030], [0.036, 0, 0],
  ].map(p => new THREE.Vector3(...p)));
  const geometry = parts.geometry('flexible camera ribbon', () => {
    const columns = 24, rows = 36;
    const mesh = surface(columns, rows, (u, v) => {
      const p = curve.getPoint(v);
      return [p.x + (u - 0.5) * 0.0072, p.y, p.z];
    });
    const indices = mesh.index.array, insulation = [], copper = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const offset = (row * columns + col) * 6;
        const batch = col % 4 === 2 ? copper : insulation;
        for (let n = 0; n < 6; n++) batch.push(indices[offset + n]);
      }
    }
    mesh.setIndex(insulation.concat(copper));
    mesh.addGroup(0, insulation.length, 0);
    mesh.addGroup(insulation.length, copper.length, 1);
    return mesh;
  });
  const ribbon = parts.mesh(camera, 'camera-flex', geometry, 'flex');
  parts.materials.flex.side = parts.materials.traces.side = THREE.DoubleSide;
  ribbon.material = [parts.materials.flex, parts.materials.traces];
  parts.plate(camera, 'flex-socket', 'black', 0.014, 0.006, 0.006, 0.0018, 0.009, 0.017, -0.031);
}

function buildReferenceGimbalHead(parts, yaw) {
  const frame = group(yaw, 'camera-carrier', 0, -0.047, 0);
  parts.plate(yaw, 'yaw-backplate', 'black', 0.040, 0.008, 0.067, 0.007, 0, -0.003, -0.025);
  parts.plate(frame, 'rear-carrier-spine', 'rim', 0.018, 0.089, 0.006, 0.0024, 0, -0.001, -0.054);
  parts.mesh(frame, 'formed-aluminium-yoke', parts.geometry('formed camera yoke', yokeGeometry), 'brushed');
  for (const side of [-1, 1]) {
    const pin = group(frame, 'pitch-bearing', side * 0.039, 0, 0);
    pin.rotation.z = -side * Math.PI / 2;
    parts.turned(pin, 'reference-trunnion', 'brushed', [
      [0, -0.005], [0.0108, -0.005], [0.0137, -0.0025], [0.0143, 0.0002],
      [0.0143, 0.0050], [0.0131, 0.0066], [0.010, 0.0071], [0.0096, 0.0066], [0, 0.0066],
    ]);
    parts.turned(pin, 'pivot-washer', 'steel', [
      [0, 0.0063], [0.008, 0.0063], [0.0084, 0.0071], [0.008, 0.0082], [0.0045, 0.0082], [0, 0.0077],
    ]);
    parts.screws(pin, 'bearing-fastener', [[0, 0.0074, 0]], 0.0048);
  }
  const pitch = group(yaw, 'gimbal-pitch', 0, -0.047, 0);
  const camera = group(pitch, 'camera');
  const lower = parts.plate(camera, 'camera-body', 'cameraCast', 0.069, 0.045, 0.063, 0.009, 0, -0.007, -0.001);
  const upper = parts.plate(camera, 'camera-top', 'cameraCast', 0.069, 0.015, 0.063, 0.009, 0, 0.022, -0.001);
  finishUV(lower.geometry);
  finishUV(upper.geometry);
  parts.plate(camera, 'camera-parting-line', 'rubber', 0.068, 0.0025, 0.062, 0.0088, 0, 0.015, -0.001);
  parts.screws(camera, 'camera-cover-fasteners', [-0.024, 0.024].flatMap(x =>
    [-0.019, 0.017].map(z => [x, 0.0294, z])), 0.0022).material = parts.materials.toolBlack;
  cameraRibbon(parts, camera);
  const lens = group(camera, 'lens', 0, 0, 0.022);
  lens.rotation.x = Math.PI / 2;
  parts.turned(lens, 'reference-lens-mount', 'lensMetal', [
    [0, 0], [0.0326, 0], [0.033, 0.004], [0.033, 0.008], [0.0308, 0.0095],
    [0.0305, 0.0118], [0.0294, 0.013], [0.0294, 0.034], [0.0307, 0.0348],
    [0.031, 0.0367], [0.0302, 0.0383], [0.0276, 0.0385], [0.0264, 0.0375],
    [0.0248, 0.0320], [0.0236, 0.0265], [0.021, 0.019], [0.0124, 0.013], [0, 0.012],
  ]);
  parts.mesh(lens, 'fluted-focus-ring', parts.geometry('fluted focus ring', focusRing), 'lensMetal');
  parts.turned(lens, 'retaining-ring', 'black', [
    [0.0244, 0.030], [0.0267, 0.0320], [0.0272, 0.0347],
    [0.0268, 0.0354], [0.0257, 0.0354], [0.0246, 0.0333], [0.0244, 0.030],
  ]);
  const outer = parts.mesh(lens, 'coated-objective', parts.geometry('front coated element',
    () => objectiveGeometry(0.0255, 0, 0.0268, 0.0051, 0)), 'frontCoating');
  outer.castShadow = false;
  parts.turned(lens, 'internal-lens-spacer', 'iris', [
    [0.0200, 0.0165], [0.0200, 0.0215], [0.0188, 0.0225],
    [0.0173, 0.0225], [0.0167, 0.0215], [0.0162, 0.0190],
  ]);
  parts.mesh(lens, 'inner-objective', parts.geometry('inner coated element',
    () => objectiveGeometry(0.0184, 0.0032, 0.0190, 0.0068, 1.4)), 'coatedLens');
  parts.rod(lens, 'diaphragm', 'iris', 0.0051, [0, 0.0168, 0], [0, 0.0180, 0]);
  const dome = parts.mesh(lens, 'front-element',
    parts.geometry('reference optical dome', () => new THREE.SphereGeometry(1, 64, 20, 0, TAU, 0, Math.PI / 2)),
    'glass', 0, 0.0327, 0);
  dome.scale.set(0.0253, 0.0032, 0.0253);
  dome.castShadow = false;
  parts.materials.glass.iridescence = 0.7;
  parts.materials.glass.opacity = 0.17;
}

/**
 * 创建独立的纯代码六旋翼模型，返回 THREE.Group。仅依赖 three。
 * 单位为米，+Y 向上，+Z 朝机头，原点在两条滑橇之间的地面上。
 * 对置电机轴距 0.90 m，机壳宽 0.27 m。可用 scale.setScalar() 整体缩放。
 * rotor-1 到 rotor-6 绕各自的本地 Y 轴旋转，spinSign 在节点的 userData 中。
 * animations 中的 rotor-spin 是一秒一圈的循环片段，可用 THREE.AnimationMixer 播放。
 * gimbal 控制整套云台的显隐，gimbal-pitch 绕 X 轴正转时镜头下俯。
 * version 默认为 1。传入 { version: 2 } 使用多视角部件参考图重建的外观。
 */
export function createHexacopter({ version = 1 } = {}) {
  if (version !== 1 && version !== 2) throw new RangeError('Hexacopter version must be 1 or 2');
  const model = new THREE.Group();
  model.name = 'hexacopter';
  const parts = new Parts();
  if (version === 2) {
    addReferenceFinishes(parts);
    buildReferenceBody(parts, model);
  } else {
    buildFuselage(parts, model);
  }
  const spinTracks = [];
  for (let number = 1; number <= 6; number++) {
    buildArm(parts, model, number);
    const rotor = model.getObjectByName('rotor-' + number);
    const start = rotor.rotation.y;
    spinTracks.push(new THREE.NumberKeyframeTrack(
      rotor.name + '.rotation[y]', [0, 1], [start, start + rotor.userData.spinSign * TAU],
    ));
  }
  model.animations.push(new THREE.AnimationClip('rotor-spin', 1, spinTracks));
  buildLandingGear(parts, model);
  buildGimbal(parts, model, version === 2);
  ownedParts.set(model, parts);
  return model;
}

/** 移出场景并释放这次工厂调用创建的资源。共享该模型资源的 clone 应先停止使用。 */
export function disposeHexacopter(model) {
  const parts = ownedParts.get(model);
  if (!parts) return;
  model.removeFromParent();
  parts.dispose();
  ownedParts.delete(model);
}
