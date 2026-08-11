#!/usr/bin/env node
/**
 * tools/simulate.js — headless player simulator for Flock Together.
 *
 * Runs N fake phones against a live server so a whole game can be played, and
 * the grouping judged, without 15 humans and 15 phones.
 *
 *   node tools/simulate.js --room ABCD --players 12
 *   node tools/simulate.js --auto-create --players 14 --miss 2 --slow 3
 *   node tools/simulate.js --auto-create --players 12 --url http://192.168.1.9:3000
 *
 * Flags
 *   --room CODE        room to join (required unless --auto-create)
 *   --players N        how many simulated phones (default 12)
 *   --url ORIGIN       server origin (default http://localhost:3000)
 *   --miss N           N players never answer, exercising noAnswer[]
 *   --slow N           N players answer inside the last 2 seconds
 *   --auto-create      open a host socket, create the room, start the game
 *   --seed N           fixed RNG seed, so a suspicious round can be replayed
 *   --quiet            drop the per-answer lines, keep phases and reveals
 *
 * Each phone joins, then picks a fleece colour and a hat, and only then plays:
 * the server does not count a player as part of the flock until a look is
 * accepted, and drops anyone still choosing when the game starts. The pair is
 * derived from the player's index, so a seeded run dresses the same sheep the
 * same way every time — see slotForIndex.
 *
 * This is a developer tool. It has no design system involvement: plain text,
 * plain ANSI, no icons. The log is the product — it is how a developer decides
 * whether the semantic grouping is any good.
 *
 * Dependencies: 'ws' only. Pure ESM. Node 24.
 */

// ---------------------------------------------------------------------------
// 0. Dependencies
// ---------------------------------------------------------------------------

/* The colours, the hats and the wire format of a look key all live in one
 * module that the server imports too. Importing it here rather than restating
 * any of it is what stops this tool asking for a sheep the server will reject. */
import { FLEECE_COLOURS, HATS, LOOK_COMBINATIONS, lookKey } from '../public/shared/look.js';

let WebSocket;
try {
  ({ default: WebSocket } = await import('ws'));
} catch {
  console.error(
    "simulate.js needs the 'ws' package, which is already a dependency of this\n" +
      'project but does not appear to be installed. Run `npm install` in the\n' +
      'project root first.'
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. Random (seedable, so a bad grouping can be reproduced)
// ---------------------------------------------------------------------------

let rngState = (Date.now() ^ 0x9e3779b9) >>> 0;

function seedRng(seed) {
  rngState = (Number(seed) >>> 0) || 1;
}

/** mulberry32 — small, fast, good enough for fake party guests. */
function rnd() {
  rngState = (rngState + 0x6d2b79f5) >>> 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Inclusive integer in [lo, hi]. */
function randInt(lo, hi) {
  if (hi <= lo) return lo;
  return lo + Math.floor(rnd() * (hi - lo + 1));
}

function pick(list) {
  return list[Math.floor(rnd() * list.length)];
}

function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. CLI
// ---------------------------------------------------------------------------

const USAGE = `
Usage: node tools/simulate.js --room ABCD --players 12 [options]
       node tools/simulate.js --auto-create --players 12 [options]

  --room CODE      room code to join (required unless --auto-create)
  --players N      number of simulated players (default 12)
  --url ORIGIN     server origin (default http://localhost:3000)
  --miss N         players who never answer, per round (default 0)
  --slow N         players who answer in the last 2 seconds (default 0)
  --auto-create    create the room and start the game from here
  --seed N         fixed RNG seed for a reproducible run
  --quiet          suppress the per-answer lines
  --help           this text
`;

function parseArgs(argv) {
  const opts = {
    room: null,
    players: 12,
    url: 'http://localhost:3000',
    miss: 0,
    slow: 0,
    autoCreate: false,
    seed: null,
    quiet: false,
  };

  const wantsValue = new Set(['--room', '--players', '--url', '--miss', '--slow', '--seed']);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    let key = arg;
    let value = null;

    const eq = arg.indexOf('=');
    if (arg.startsWith('--') && eq > 2) {
      key = arg.slice(0, eq);
      value = arg.slice(eq + 1);
    } else if (wantsValue.has(arg)) {
      value = argv[i + 1] ?? null;
      i += 1;
    }

    switch (key) {
      case '--help':
      case '-h':
        console.log(USAGE.trim());
        process.exit(0);
        break;
      case '--room':
        opts.room = String(value ?? '').trim().toUpperCase();
        break;
      case '--players':
        opts.players = Number(value);
        break;
      case '--url':
        opts.url = String(value ?? '').trim();
        break;
      case '--miss':
        opts.miss = Number(value);
        break;
      case '--slow':
        opts.slow = Number(value);
        break;
      case '--seed':
        opts.seed = Number(value);
        break;
      case '--auto-create':
        opts.autoCreate = true;
        break;
      case '--quiet':
        opts.quiet = true;
        break;
      default:
        die(`Unknown option "${arg}".\n${USAGE.trim()}`);
    }
  }

  if (!Number.isInteger(opts.players) || opts.players < 1) die('--players must be a positive integer.');
  if (opts.players > 20) {
    warnLine(`--players ${opts.players} exceeds the server's default MAX_PLAYERS of 20; extras will be rejected as ROOM_FULL.`);
  }
  if (!Number.isInteger(opts.miss) || opts.miss < 0) die('--miss must be a non-negative integer.');
  if (!Number.isInteger(opts.slow) || opts.slow < 0) die('--slow must be a non-negative integer.');
  if (opts.miss + opts.slow > opts.players) die('--miss plus --slow cannot exceed --players.');
  if (!opts.autoCreate && !opts.room) die('Either --room CODE or --auto-create is required.\n' + USAGE.trim());
  if (opts.autoCreate && opts.room) {
    warnLine('--auto-create ignores --room; the server allocates the code.');
    opts.room = null;
  }
  if (opts.seed !== null) {
    if (!Number.isFinite(opts.seed)) die('--seed must be a number.');
    seedRng(opts.seed);
  }
  return opts;
}

/** http://host:3000 -> ws://host:3000/socket (also accepts ws:// and wss://). */
function socketUrl(origin) {
  let base = origin.replace(/\/+$/, '');
  if (base.startsWith('https://')) base = `wss://${base.slice('https://'.length)}`;
  else if (base.startsWith('http://')) base = `ws://${base.slice('http://'.length)}`;
  else if (!base.startsWith('ws://') && !base.startsWith('wss://')) base = `ws://${base}`;
  return `${base}/socket`;
}

// ---------------------------------------------------------------------------
// 3. Names and looks
//
// Names: plausible, distinct, no duplicates (the server rejects NAME_TAKEN).
// Looks: a colour+hat pair per phone, derived from the phone's index so a run
// with the same --players is dressed identically every time. Uniqueness is on
// the PAIR and the server is the authority on it, so the assignment below is a
// starting point that Sim.claimSlot and the LOOK_TAKEN retry walk forward from.
// ---------------------------------------------------------------------------

const NAMES = [
  'Ama', 'Bex', 'Caleb', 'Dilnaz', 'Elif', 'Femi', 'Grace', 'Hugo',
  'Ines', 'Jonas', 'Kirra', 'Lior', 'Mira', 'Nadia', 'Omar', 'Priya',
  'Quinn', 'Rafa', 'Sunmi', 'Tomas', 'Umut', 'Vera', 'Wes', 'Xiulan',
  'Yusuf', 'Zoe', 'Aiden', 'Bruna', 'Cato', 'Dario', 'Esme', 'Freya',
  'Gus', 'Hana', 'Ivo', 'Juno', 'Kemal', 'Lena', 'Mateo', 'Noor',
  'Otto', 'Pia', 'Rhys', 'Suki', 'Theo', 'Ursa', 'Viv', 'Zane',
];

function nameFor(index, chosen) {
  const pool = NAMES.filter((n) => !chosen.has(n));
  if (pool.length > 0) return pick(pool);
  return `Player${index + 1}`;
}

/**
 * Slot -> the pair it stands for. Walking the colours one at a time while the
 * hat also advances means the first twenty slots — a full room — differ in BOTH
 * halves, so a bug that swaps two players' colours or two players' hats is
 * visible on the TV rather than hidden behind a shared hat.
 *
 * The arithmetic only spreads the pairs out; it is Sim.claimSlot that
 * guarantees no two simulated phones ever hold the same one.
 */
function lookForSlot(slot) {
  const n = ((slot % LOOK_COMBINATIONS) + LOOK_COMBINATIONS) % LOOK_COMBINATIONS;
  const colour = FLEECE_COLOURS[n % FLEECE_COLOURS.length];
  const hat = HATS[(n + Math.floor(n / FLEECE_COLOURS.length)) % HATS.length];
  return { colorId: colour.id, hatId: hat.id };
}

/** Where a phone starts looking: its index, which is what makes a run repeat. */
const slotForIndex = (index) => ((index % LOOK_COMBINATIONS) + LOOK_COMBINATIONS) % LOOK_COMBINATIONS;

/** `colorId/hatId` — the same string the server puts in look.taken. */
const lookLabel = (look) => lookKey(look) || 'unchosen';

/** Widest label the ids can produce, so the answer column never ragged-edges. */
const LOOK_WIDTH =
  Math.max(...FLEECE_COLOURS.map((c) => c.id.length)) +
  1 +
  Math.max(...HATS.map((h) => h.id.length));

// ---------------------------------------------------------------------------
// 4. Answers
//
// Each question shape maps to a list of CLUSTERS. A cluster is one meaning with
// several surface forms — deliberately including casing, article and hyphen
// variants — so semantic grouping has real work to do and a developer can see
// at a glance whether it did it. `w` is the relative weight, which is what
// makes a majority form.
// ---------------------------------------------------------------------------

/** A(weight, canonicalForm, ...variants) */
const A = (w, ...forms) => ({ w, label: forms[0], forms });

/** q([match keys], ...clusters) */
const q = (keys, ...clusters) => ({ keys, clusters });

const QUESTION_ANSWERS = [
  // ---- concrete categories -------------------------------------------------
  q(['hot beverage'],
    A(7, 'tea', 'Tea', 'a cup of tea', 'cuppa', 'cup of tea'),
    A(6, 'coffee', 'Coffee', 'a coffee', 'black coffee'),
    A(3, 'hot chocolate', 'Hot Chocolate', 'hot choc', 'cocoa'),
    A(1, 'mulled wine'),
    A(1, 'lemon and honey', 'hot lemon')),
  q(['yellow fruit'],
    A(9, 'banana', 'Banana', 'bananas', 'a banana'),
    A(4, 'lemon', 'Lemon', 'lemons'),
    A(2, 'pineapple', 'Pineapple'),
    A(1, 'mango'),
    A(1, 'grapefruit')),
  q(['green vegetable'],
    A(6, 'broccoli', 'Broccoli', 'brocolli'),
    A(5, 'peas', 'Peas', 'garden peas', 'pea'),
    A(3, 'spinach', 'Spinach'),
    A(2, 'green beans', 'beans', 'runner beans'),
    A(1, 'cucumber')),
  q(['farm animal'],
    A(6, 'cow', 'Cow', 'cows', 'a cow'),
    A(6, 'sheep', 'Sheep', 'a sheep'),
    A(4, 'pig', 'Pig', 'pigs'),
    A(3, 'chicken', 'Chicken', 'chickens', 'hen'),
    A(1, 'horse', 'horses')),
  q(['big cat'],
    A(8, 'lion', 'Lion', 'a lion'),
    A(6, 'tiger', 'Tiger', 'tigers'),
    A(3, 'leopard', 'Leopard'),
    A(2, 'cheetah', 'Cheetah'),
    A(1, 'jaguar')),
  q(['bird you see'],
    A(6, 'robin', 'Robin', 'a robin'),
    A(5, 'sparrow', 'Sparrow', 'house sparrow'),
    A(4, 'pigeon', 'Pigeon', 'pigeons'),
    A(3, 'blackbird', 'Blackbird'),
    A(2, 'blue tit', 'bluetit')),
  q(['jungle animal'],
    A(7, 'monkey', 'Monkey', 'monkeys', 'a monkey'),
    A(5, 'tiger', 'Tiger'),
    A(4, 'snake', 'Snake', 'snakes'),
    A(2, 'parrot', 'Parrot'),
    A(2, 'elephant')),
  q(['dog breed'],
    A(7, 'labrador', 'Labrador', 'lab', 'a labrador'),
    A(4, 'poodle', 'Poodle'),
    A(4, 'german shepherd', 'German Shepherd', 'alsatian'),
    A(2, 'beagle'),
    A(1, 'dachshund', 'sausage dog')),
  q(['name a planet'],
    A(7, 'mars', 'Mars'),
    A(6, 'jupiter', 'Jupiter'),
    A(4, 'saturn', 'Saturn'),
    A(2, 'venus', 'Venus'),
    A(1, 'earth', 'Earth')),
  q(['type of pasta'],
    A(8, 'spaghetti', 'Spaghetti', 'spagetti'),
    A(5, 'penne', 'Penne'),
    A(3, 'fusilli', 'fuselli', 'twirly ones'),
    A(2, 'lasagne', 'lasagna'),
    A(1, 'macaroni')),
  q(['type of bread'],
    A(6, 'sourdough', 'Sourdough', 'sour dough'),
    A(5, 'white', 'white bread', 'plain white'),
    A(4, 'rye', 'rye bread'),
    A(3, 'baguette', 'french stick'),
    A(1, 'wholemeal', 'brown bread')),
  q(['type of cheese'],
    A(8, 'cheddar', 'Cheddar', 'mature cheddar'),
    A(4, 'brie', 'Brie'),
    A(4, 'mozzarella', 'Mozzarella', 'mozarella'),
    A(2, 'parmesan'),
    A(1, 'blue cheese', 'stilton')),
  q(['ice cream flavor', 'ice cream flavour'],
    A(7, 'vanilla', 'Vanilla', 'plain vanilla'),
    A(6, 'chocolate', 'Chocolate', 'choc'),
    A(4, 'strawberry', 'Strawberry'),
    A(3, 'mint choc chip', 'mint chocolate chip', 'mint choc-chip'),
    A(1, 'pistachio')),
  q(['pizza topping'],
    A(8, 'pepperoni', 'Pepperoni', 'peperoni'),
    A(5, 'mushroom', 'mushrooms', 'Mushrooms'),
    A(4, 'cheese', 'extra cheese'),
    A(3, 'pineapple', 'Pineapple'),
    A(2, 'olives', 'olive')),
  q(['fizzy drink'],
    A(8, 'coke', 'Coke', 'a coke', 'cola', 'coca cola'),
    A(4, 'lemonade', 'Lemonade'),
    A(3, 'sprite', 'Sprite'),
    A(2, 'fanta', 'Fanta', 'orange fanta'),
    A(1, 'ginger ale', 'ginger beer')),
  q(['name a flower'],
    A(9, 'rose', 'Rose', 'roses', 'a rose'),
    A(5, 'tulip', 'Tulip', 'tulips'),
    A(3, 'daisy', 'Daisy', 'daisies'),
    A(2, 'sunflower', 'Sunflower'),
    A(1, 'lily')),
  q(['instrument in an orchestra'],
    A(7, 'violin', 'Violin', 'a violin'),
    A(4, 'flute', 'Flute'),
    A(4, 'cello', 'Cello'),
    A(3, 'trumpet', 'Trumpet'),
    A(1, 'timpani', 'drums')),
  q(['sport played with a ball'],
    A(7, 'football', 'Football', 'soccer'),
    A(5, 'basketball', 'Basketball'),
    A(4, 'tennis', 'Tennis'),
    A(3, 'cricket', 'Cricket'),
    A(1, 'golf')),
  q(['school subject'],
    A(6, 'maths', 'Maths', 'math', 'mathematics'),
    A(5, 'english', 'English'),
    A(4, 'history', 'History'),
    A(3, 'science', 'Science', 'biology'),
    A(2, 'PE', 'pe', 'gym')),
  q(['card game'],
    A(6, 'poker', 'Poker'),
    A(5, 'snap', 'Snap'),
    A(4, 'go fish', 'Go Fish', 'gofish'),
    A(3, 'uno', 'UNO'),
    A(2, 'bridge', 'Bridge')),
  q(['board game'],
    A(9, 'monopoly', 'Monopoly', 'MONOPOLY'),
    A(5, 'scrabble', 'Scrabble'),
    A(4, 'chess', 'Chess'),
    A(2, 'cluedo', 'Cluedo', 'clue'),
    A(1, 'risk')),
  q(['name a shape'],
    A(8, 'circle', 'Circle', 'a circle'),
    A(6, 'square', 'Square'),
    A(4, 'triangle', 'Triangle'),
    A(2, 'rectangle', 'Rectangle', 'oblong'),
    A(1, 'hexagon')),
  q(['bone in the human body'],
    A(7, 'femur', 'Femur', 'the femur'),
    A(5, 'skull', 'Skull'),
    A(4, 'rib', 'ribs', 'Ribs'),
    A(3, 'collarbone', 'clavicle'),
    A(1, 'kneecap', 'patella')),
  q(['type of hat'],
    A(6, 'baseball cap', 'Baseball Cap', 'cap', 'a baseball cap'),
    A(5, 'beanie', 'Beanie', 'bobble hat'),
    A(4, 'top hat', 'Top Hat', 'tophat'),
    A(2, 'sombrero'),
    A(2, 'cowboy hat', 'stetson')),
  q(['kitchen appliance'],
    A(6, 'toaster', 'Toaster', 'a toaster'),
    A(6, 'kettle', 'Kettle', 'the kettle'),
    A(4, 'microwave', 'Microwave'),
    A(3, 'blender', 'Blender'),
    A(1, 'fridge', 'refrigerator')),

  // ---- everyday places and containers -------------------------------------
  q(['hotel bathroom'],
    A(8, 'tiny soap', 'little soap', 'a tiny soap', 'small soap'),
    A(5, 'shampoo', 'Shampoo', 'mini shampoo'),
    A(4, 'towels', 'towel', 'Towels'),
    A(3, 'hairdryer', 'hair dryer'),
    A(1, 'shower cap')),
  q(['first aid kit'],
    A(8, 'plasters', 'plaster', 'Plasters', 'band aid', 'bandaid'),
    A(5, 'bandage', 'bandages'),
    A(3, 'scissors', 'tiny scissors'),
    A(3, 'antiseptic', 'antiseptic wipes', 'alcohol wipes'),
    A(1, 'tweezers')),
  q(['toolbox'],
    A(8, 'hammer', 'Hammer', 'a hammer'),
    A(6, 'screwdriver', 'Screwdriver', 'screw driver'),
    A(4, 'tape measure', 'tape-measure', 'measuring tape'),
    A(2, 'pliers'),
    A(2, 'spanner', 'wrench')),
  q(['pencil case'],
    A(8, 'pencil', 'a pencil', 'pencils'),
    A(5, 'rubber', 'eraser', 'a rubber'),
    A(4, 'ruler', 'Ruler'),
    A(3, 'pen', 'biro'),
    A(1, 'sharpener', 'pencil sharpener')),
  q(['picnic basket'],
    A(7, 'sandwiches', 'sandwich', 'Sandwiches'),
    A(5, 'blanket', 'picnic blanket', 'a blanket'),
    A(4, 'crisps', 'chips', 'a bag of crisps'),
    A(3, 'wine', 'a bottle of wine'),
    A(1, 'strawberries')),
  q(['vending machine'],
    A(7, 'crisps', 'chips', 'a packet of crisps'),
    A(6, 'chocolate bar', 'chocolate', 'a choc bar'),
    A(4, 'coke', 'a can of coke', 'cola'),
    A(2, 'gum', 'chewing gum'),
    A(1, 'sad sandwich', 'sandwich')),
  q(['on your desk right now'],
    A(7, 'laptop', 'Laptop', 'my laptop'),
    A(6, 'mug of coffee', 'coffee', 'a cold coffee', 'mug'),
    A(4, 'phone', 'my phone'),
    A(3, 'notebook', 'a notebook'),
    A(2, 'pen', 'a pen')),
  q(['door of your fridge'],
    A(8, 'milk', 'Milk', 'the milk'),
    A(5, 'ketchup', 'Ketchup', 'tomato ketchup'),
    A(4, 'butter', 'Butter'),
    A(3, 'eggs', 'egg'),
    A(1, 'jam')),
  q(['take to the beach'],
    A(7, 'towel', 'a towel', 'beach towel'),
    A(6, 'sunscreen', 'suncream', 'sun cream', 'sunblock'),
    A(4, 'sunglasses', 'shades'),
    A(3, 'bucket and spade', 'bucket & spade'),
    A(1, 'a book', 'book')),
  q(['wear in the rain'],
    A(7, 'raincoat', 'rain coat', 'a raincoat', 'cagoule'),
    A(5, 'wellies', 'wellingtons', 'rain boots'),
    A(4, 'hood', 'my hood up'),
    A(3, 'waterproof trousers', 'waterproofs'),
    A(1, 'a hat', 'hat')),
  q(['at the dentist'],
    A(7, 'the chair', 'a chair', 'that reclining chair'),
    A(5, 'drill', 'the drill', 'a drill'),
    A(4, 'little mirror', 'mirror', 'tiny mirror'),
    A(3, 'fish tank', 'a fish tank'),
    A(1, 'spit sink', 'the sink')),
  q(['spice that lives in every kitchen'],
    A(7, 'salt', 'Salt'),
    A(6, 'pepper', 'black pepper', 'Pepper'),
    A(4, 'paprika', 'Paprika'),
    A(3, 'cinnamon', 'Cinnamon'),
    A(2, 'cumin')),
  q(['comes in a tin'],
    A(8, 'beans', 'baked beans', 'Beans'),
    A(5, 'tuna', 'Tuna', 'tinned tuna'),
    A(4, 'soup', 'Soup', 'tomato soup'),
    A(3, 'sweetcorn', 'sweet corn'),
    A(1, 'biscuits', 'quality street')),
  q(['put on toast'],
    A(7, 'butter', 'Butter', 'just butter'),
    A(6, 'jam', 'Jam', 'strawberry jam'),
    A(4, 'marmite', 'Marmite'),
    A(4, 'peanut butter', 'peanut-butter', 'PB'),
    A(2, 'beans', 'baked beans')),
  q(['drawer that every home has'],
    A(9, 'junk drawer', 'the junk drawer', 'junk-drawer', 'drawer of junk'),
    A(5, 'cutlery drawer', 'the cutlery drawer', 'knife and fork drawer'),
    A(3, 'sock drawer', 'the sock drawer'),
    A(2, 'underwear drawer', 'pants drawer'),
    A(1, 'tea towel drawer')),
  q(['in your pocket or bag'],
    A(8, 'keys', 'my keys', 'Keys'),
    A(6, 'phone', 'my phone'),
    A(4, 'wallet', 'purse'),
    A(3, 'tissue', 'a used tissue', 'tissues'),
    A(1, 'lip balm', 'chapstick')),
  q(['camping gear'],
    A(8, 'tent', 'a tent', 'Tent'),
    A(5, 'sleeping bag', 'sleeping-bag'),
    A(4, 'torch', 'flashlight', 'head torch'),
    A(3, 'camping stove', 'stove', 'gas stove'),
    A(1, 'roll mat', 'sleeping mat')),

  // ---- observed life -------------------------------------------------------
  q(['always lose'],
    A(9, 'keys', 'my keys', 'Keys', 'house keys'),
    A(5, 'socks', 'one sock', 'a sock'),
    A(4, 'phone charger', 'charger', 'my charger'),
    A(3, 'glasses', 'my glasses'),
    A(1, 'the TV remote', 'remote')),
  q(['chore nobody wants'],
    A(7, 'cleaning the toilet', 'clean the toilet', 'the toilet', 'scrubbing the loo'),
    A(6, 'washing up', 'the dishes', 'dishes', 'doing the dishes'),
    A(4, 'ironing', 'the ironing'),
    A(3, 'taking out the bins', 'bins', 'the bins'),
    A(1, 'hoovering', 'vacuuming')),
  q(['never lend out'],
    A(7, 'my car', 'car', 'the car'),
    A(6, 'my phone', 'phone'),
    A(4, 'a book', 'books', 'my books'),
    A(3, 'my charger', 'charger'),
    A(1, 'my good pen', 'nice pen')),
  q(['excuse for being late'],
    A(8, 'traffic', 'the traffic', 'traffic was awful', 'Traffic'),
    A(5, 'the train was delayed', 'train delay', 'train was late'),
    A(4, 'I overslept', 'overslept', 'slept through my alarm'),
    A(3, 'no parking', 'couldnt find parking'),
    A(1, 'the dog ate my keys')),
  q(['look busy'],
    A(7, 'type fast', 'typing', 'typing loudly'),
    A(5, 'carry papers', 'walk around with paper', 'carrying a folder'),
    A(4, 'walk fast', 'walking quickly'),
    A(3, 'stare at a spreadsheet', 'frown at a spreadsheet'),
    A(1, 'sigh a lot')),
  q(['pretend to have read'],
    A(7, 'War and Peace', 'war and peace'),
    A(5, 'Ulysses', 'ulysses'),
    A(4, 'the Bible', 'the bible'),
    A(3, 'Moby Dick', 'moby dick'),
    A(2, '1984', 'Nineteen Eighty-Four')),
  q(['sound that wakes you up'],
    A(8, 'my alarm', 'alarm', 'the alarm clock', 'Alarm'),
    A(5, 'birds', 'birdsong', 'the birds'),
    A(4, 'bin lorry', 'the bin men', 'garbage truck'),
    A(3, 'a dog barking', 'dog barking', 'barking'),
    A(1, 'the phone')),
  q(['forget to pack'],
    A(8, 'toothbrush', 'my toothbrush', 'Toothbrush'),
    A(6, 'charger', 'phone charger', 'my charger'),
    A(4, 'socks', 'enough socks'),
    A(3, 'pants', 'underwear'),
    A(1, 'toothpaste')),
  q(['leave a party early'],
    A(7, 'the babysitter', 'babysitter', 'babysitter has to go'),
    A(5, 'early start tomorrow', 'work in the morning', 'early start'),
    A(4, 'headache', 'I have a headache'),
    A(3, 'the dog needs letting out', 'the dog'),
    A(1, 'I left the oven on')),
  q(['when the wifi dies'],
    A(8, 'is it just me?', 'is it just me', 'Is it just me?'),
    A(5, 'the wifi is down', 'wifis down', 'wifi is down'),
    A(4, 'turn it off and on again', 'have you tried restarting it'),
    A(3, 'can you hear me?', 'you cut out'),
    A(1, 'I blame the router')),
  q(['only once a year'],
    A(8, 'christmas decorations', 'the christmas tree', 'xmas decorations'),
    A(5, 'my passport', 'passport'),
    A(4, 'suitcase', 'the suitcase'),
    A(3, 'the good plates', 'fancy plates', 'best china'),
    A(1, 'the barbecue', 'bbq')),
  q(['keep for far too long'],
    A(7, 'takeaway sauce sachets', 'sauce sachets', 'ketchup packets'),
    A(5, 'old chargers', 'cables', 'a drawer of cables'),
    A(4, 'leftovers', 'leftovers in the fridge'),
    A(3, 'receipts', 'old receipts'),
    A(2, 'carrier bags', 'plastic bags')),
  q(['smell that means home'],
    A(7, 'baking bread', 'fresh bread', 'bread in the oven'),
    A(5, 'fresh laundry', 'clean washing', 'laundry'),
    A(4, 'coffee', 'fresh coffee'),
    A(4, 'a roast dinner', 'sunday roast', 'roast chicken'),
    A(1, 'wood smoke', 'a fire')),
  q(['say to a dog'],
    A(8, "who's a good boy", 'whos a good boy', 'good boy', 'Good boy!'),
    A(5, 'sit', 'Sit!', 'sit down'),
    A(4, 'come here', 'here boy', 'come'),
    A(3, 'no', 'No!', 'drop it'),
    A(1, 'walkies')),
  q(['cannot be bothered'],
    A(8, 'beans on toast', 'beans on toast again', 'toast and beans'),
    A(6, 'pasta', 'plain pasta', 'pasta and pesto'),
    A(4, 'eggs', 'scrambled eggs', 'egg on toast'),
    A(3, 'instant noodles', 'noodles', 'ramen'),
    A(1, 'cereal')),
  q(['while on hold'],
    A(7, 'doodle', 'doodling', 'draw on something'),
    A(6, 'scroll my phone', 'scroll', 'look at my phone'),
    A(4, 'tidy up', 'wash up', 'do the dishes'),
    A(3, 'put it on speaker', 'speakerphone'),
    A(1, 'hum along to the music')),
  q(['snack you eat standing up'],
    A(7, 'crisps', 'chips', 'a handful of crisps'),
    A(5, 'toast', 'a slice of toast'),
    A(4, 'cheese', 'a bit of cheese', 'cheese from the fridge'),
    A(3, 'biscuit', 'a biscuit', 'biscuits'),
    A(1, 'cereal', 'dry cereal')),
  q(['first thing you do in the morning'],
    A(8, 'check my phone', 'look at my phone', 'phone'),
    A(5, 'pee', 'go to the loo', 'bathroom'),
    A(4, 'coffee', 'make coffee', 'put the kettle on'),
    A(3, 'turn off the alarm', 'snooze', 'hit snooze'),
    A(1, 'stretch')),
  q(['always broken at work'],
    A(9, 'the printer', 'printer', 'The Printer'),
    A(5, 'coffee machine', 'the coffee machine'),
    A(4, 'the wifi', 'wifi'),
    A(3, 'air conditioning', 'the aircon', 'aircon'),
    A(1, 'the lift', 'elevator')),
  q(['grab in a fire'],
    A(7, 'my phone', 'phone'),
    A(6, 'the dog', 'my dog', 'the cat'),
    A(4, 'photos', 'photo albums', 'old photos'),
    A(3, 'my laptop', 'laptop'),
    A(2, 'passport', 'my passport')),
  q(['rule that everybody breaks'],
    A(8, 'the speed limit', 'speed limit', 'speeding'),
    A(5, 'jaywalking', 'crossing on red'),
    A(4, 'no phones at the table', 'no phones'),
    A(3, 'one per customer', 'take one only'),
    A(1, 'no food at the desk')),
  q(['worst time for the phone to ring'],
    A(7, 'dinner', 'at dinner', 'during dinner'),
    A(6, 'in the shower', 'the shower'),
    A(4, '3am', 'the middle of the night', '3 am'),
    A(3, 'in a meeting', 'during a meeting'),
    A(1, 'at the cinema')),

  // ---- mild opinion --------------------------------------------------------
  q(['sandwich that starts an argument'],
    A(8, 'hot dog', 'Hotdog', 'a hot-dog', 'hotdog', 'sausage in a bun'),
    A(5, 'marmite', 'Marmite sandwich', 'marmite sarnie'),
    A(4, 'cucumber', 'cucumber sandwich', 'cucumber sandwiches'),
    A(3, 'tuna and sweetcorn', 'tuna sweetcorn'),
    A(2, 'peanut butter and jam', 'PB&J', 'pb and j')),
  q(['irrationally afraid of'],
    A(8, 'spiders', 'a spider', 'Spiders'),
    A(5, 'clowns', 'Clowns'),
    A(4, 'buttons', 'Buttons'),
    A(3, 'moths', 'a moth'),
    A(2, 'heights', 'high places')),
  q(['best day of the week'],
    A(8, 'friday', 'Friday', 'FRIDAY'),
    A(6, 'saturday', 'Saturday'),
    A(4, 'sunday', 'Sunday'),
    A(2, 'thursday', 'Thursday'),
    A(1, 'wednesday')),
  q(['better cold'],
    A(8, 'pizza', 'cold pizza', 'Pizza'),
    A(4, 'rice pudding', 'cold rice pudding'),
    A(4, 'chicken', 'cold chicken', 'roast chicken'),
    A(3, 'pasta', 'leftover pasta'),
    A(1, 'baked beans')),
  q(['ruins a pizza'],
    A(9, 'pineapple', 'Pineapple', 'pinapple', 'pineapple obviously'),
    A(5, 'anchovies', 'anchovy'),
    A(4, 'olives', 'olive'),
    A(2, 'sweetcorn', 'sweet corn'),
    A(1, 'banana')),
  q(['useless kitchen gadget'],
    A(8, 'garlic press', 'a garlic press', 'garlic crusher'),
    A(5, 'avocado slicer', 'avocado tool'),
    A(4, 'egg boiler', 'egg cooker'),
    A(3, 'spiralizer', 'spiraliser'),
    A(1, 'banana slicer')),
  q(['worst seat on a plane'],
    A(9, 'middle seat', 'the middle', 'middle', 'middle seat obviously'),
    A(5, 'next to the toilet', 'by the toilets', 'back by the loo'),
    A(4, 'the back row', 'at the back'),
    A(2, 'next to a crying baby', 'beside the baby'),
    A(1, 'no window')),
  q(['superpower everyone would pick'],
    A(8, 'flying', 'flight', 'to fly'),
    A(6, 'invisibility', 'being invisible', 'invisible'),
    A(5, 'teleportation', 'teleporting', 'teleport'),
    A(3, 'time travel', 'stopping time'),
    A(1, 'mind reading')),
  q(['lose a fight to'],
    A(8, 'a bear', 'bear', 'Bear'),
    A(5, 'a goose', 'goose', 'swan'),
    A(4, 'a lion', 'lion'),
    A(3, 'a chimp', 'chimpanzee'),
    A(1, 'a badger')),
  q(['most annoying sound'],
    A(7, 'nails on a chalkboard', 'chalkboard scratching', 'nails down a blackboard'),
    A(5, 'a car alarm', 'car alarm', 'alarm going off'),
    A(4, 'a crying baby', 'crying baby', 'baby screaming'),
    A(4, 'leaf blower', 'a leaf blower'),
    A(1, 'someone chewing', 'chewing')),
  q(['gift that nobody wants'],
    A(8, 'socks', 'a pack of socks', 'Socks'),
    A(5, 'scented candle', 'a candle', 'candle'),
    A(4, 'novelty mug', 'a mug', 'mug'),
    A(3, 'bath set', 'shower gel set', 'smellies'),
    A(1, 'a calendar')),
  q(['looks fun but is not'],
    A(6, 'pilot', 'airline pilot', 'being a pilot'),
    A(6, 'chef', 'being a chef'),
    A(4, 'travel blogger', 'influencer', 'travel influencer'),
    A(3, 'zookeeper', 'zoo keeper'),
    A(2, 'teacher', 'teaching')),
  q(['free thing in a hotel room'],
    A(8, 'tiny soaps', 'the little soaps', 'mini soaps', 'tiny soap'),
    A(5, 'slippers', 'the slippers'),
    A(4, 'the robe', 'dressing gown', 'bathrobe'),
    A(3, 'wifi', 'the wifi'),
    A(2, 'biscuits', 'the little biscuits')),
  q(['always misspell'],
    A(8, 'definitely', 'definately', 'Definitely'),
    A(5, 'necessary', 'neccessary'),
    A(4, 'separate', 'seperate'),
    A(3, 'accommodation', 'accomodation'),
    A(1, 'restaurant')),
  q(['never looks like the photo'],
    A(8, 'a burger', 'burgers', 'fast food burger'),
    A(5, 'ikea furniture', 'IKEA furniture', 'flatpack'),
    A(4, 'a hotel room', 'hotel rooms'),
    A(3, 'a haircut', 'haircuts'),
    A(1, 'a dating profile')),
  q(['refuse to share'],
    A(7, 'my chips', 'chips', 'fries'),
    A(6, 'the last slice of pizza', 'last slice', 'last piece of pizza'),
    A(4, 'dessert', 'pudding'),
    A(3, 'my chocolate', 'chocolate'),
    A(1, 'garlic bread')),
  q(['everyone claims to like'],
    A(7, 'jazz', 'Jazz'),
    A(6, 'olives', 'Olives'),
    A(4, 'opera', 'Opera'),
    A(4, 'running', 'going running'),
    A(2, 'oysters')),
  q(['worst weather to walk in'],
    A(7, 'sideways rain', 'horizontal rain', 'rain in your face'),
    A(6, 'wind', 'strong wind', 'gales'),
    A(4, 'sleet', 'Sleet'),
    A(3, 'hail', 'hailstones'),
    A(1, 'heat', 'humid heat')),

  // ---- playfully absurd ----------------------------------------------------
  q(['terrible driver'],
    A(7, 'giraffe', 'a giraffe'),
    A(5, 'octopus', 'an octopus'),
    A(5, 'sloth', 'a sloth'),
    A(3, 'goldfish', 'a goldfish'),
    A(1, 'chicken', 'a chicken')),
  q(['bodyguard'],
    A(8, 'bear', 'a bear', 'grizzly bear'),
    A(5, 'gorilla', 'a gorilla', 'silverback'),
    A(4, 'rhino', 'a rhino'),
    A(3, 'goose', 'a goose'),
    A(1, 'honey badger')),
  q(['name for a boat'],
    A(6, 'Titanic II', 'titanic 2', 'the titanic'),
    A(5, 'Sinky', 'sinky', 'Sinky McSink'),
    A(4, 'The Leak', 'leaky', 'Leaky'),
    A(3, 'Man Overboard', 'overboard'),
    A(1, 'Unsinkable')),
  q(['name for a racehorse'],
    A(6, 'Slowpoke', 'slow poke', 'slowpoke'),
    A(5, 'Glue Factory', 'glue factory', 'Off To The Glue'),
    A(4, 'Last Place', 'last place', 'Comes Last'),
    A(3, 'Limpy', 'limpy'),
    A(1, 'Broken Leg')),
  q(['flavor for toothpaste', 'flavour for toothpaste'],
    A(7, 'fish', 'fishy', 'tuna'),
    A(5, 'garlic', 'Garlic'),
    A(4, 'bacon', 'Bacon'),
    A(4, 'onion', 'raw onion'),
    A(1, 'marmite')),
  q(['wizard keeps'],
    A(7, 'a frog', 'frog', 'toad'),
    A(5, 'a wand', 'wand', 'spare wand'),
    A(4, 'snacks', 'a snack', 'biscuits'),
    A(3, 'a beard comb', 'comb'),
    A(1, 'a very old map')),
  q(['terrible superpower'],
    A(7, 'talking to ants', 'talk to ants', 'ant telepathy'),
    A(5, 'invisible only when nobody looks', 'invisible when alone'),
    A(4, 'turning into bread', 'becoming bread'),
    A(3, 'flying one inch off the ground', 'hovering slightly'),
    A(1, 'super smell')),
  q(['job a bear could do'],
    A(7, 'lumberjack', 'a lumberjack', 'logging'),
    A(5, 'security guard', 'security', 'bouncer'),
    A(5, 'fisherman', 'fishing', 'a fisherman'),
    A(3, 'beekeeper', 'bee keeper'),
    A(1, 'hibernation consultant')),
  q(['robot would get wrong'],
    A(8, 'sarcasm', 'Sarcasm', 'irony'),
    A(5, 'small talk', 'smalltalk', 'chit chat'),
    A(4, 'hugs', 'a hug', 'hugging'),
    A(3, 'cracking an egg', 'eggs'),
    A(1, 'jokes')),
  q(['win a talent show'],
    A(7, 'a parrot', 'parrot'),
    A(5, 'a dolphin', 'dolphin'),
    A(5, 'a dog', 'dog', 'dogs'),
    A(3, 'a monkey', 'monkey'),
    A(1, 'a seal')),
  q(['theme for a wedding'],
    A(7, 'a funeral', 'funeral', 'funeral themed'),
    A(5, 'clowns', 'clown theme'),
    A(4, 'tax audit', 'accounting', 'HMRC'),
    A(3, 'zombies', 'zombie apocalypse'),
    A(1, 'medieval')),
  q(['ghosts would complain'],
    A(7, 'draughts', 'drafts', 'the draught'),
    A(5, 'being ignored', 'nobody notices them', 'no one sees them'),
    A(4, 'walls', 'walking through walls'),
    A(3, 'central heating', 'the heating'),
    A(1, 'renovations')),
  q(['dinosaur would order'],
    A(7, 'a steak', 'steak', 'a big steak'),
    A(5, 'a whole cow', 'whole cow', 'a cow'),
    A(4, 'ribs', 'a rack of ribs'),
    A(3, 'salad', 'a big salad', 'leaves'),
    A(1, 'chicken nuggets')),
  q(['desert island'],
    A(7, 'a knife', 'knife'),
    A(6, 'water', 'fresh water', 'a water filter'),
    A(4, 'a lighter', 'lighter', 'matches'),
    A(4, 'a boat', 'boat'),
    A(1, 'a hammock')),
  q(['keep in an apartment'],
    A(7, 'an elephant', 'elephant'),
    A(5, 'a horse', 'horse'),
    A(5, 'a rooster', 'rooster', 'cockerel'),
    A(3, 'a skunk', 'skunk'),
    A(1, 'a goat', 'goat')),
];

/**
 * Generic pool for questions this table does not key. Deliberately loaded with
 * near-duplicate spellings and casings so grouping quality stays visible even
 * on an unknown question.
 */
const GENERIC_CLUSTERS = [
  A(8, 'hot dog', 'Hotdog', 'a hot-dog', 'hotdog', 'sausage in a bun'),
  A(6, 'coffee', 'Coffee', 'a coffee', 'cup of coffee'),
  A(5, 'the dog', 'a dog', 'dogs', 'Dog'),
  A(4, 'keys', 'my keys', 'house keys'),
  A(3, 'pizza', 'Pizza', 'a pizza'),
  A(2, 'my phone', 'phone', 'mobile'),
  A(1, 'a bicycle', 'bike', 'bicycle'),
];

function normalizeQuestion(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9?& ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clustersFor(question) {
  const norm = normalizeQuestion(question);
  for (const entry of QUESTION_ANSWERS) {
    for (const key of entry.keys) {
      if (norm.includes(key)) return { clusters: entry.clusters, keyed: true };
    }
  }
  return { clusters: GENERIC_CLUSTERS, keyed: false };
}

/** Occasional extra sloppiness on top of the authored variants. */
function mutate(text) {
  const roll = rnd();
  if (roll < 0.74) return text;
  if (roll < 0.82) return text.toLowerCase();
  if (roll < 0.87) return text.toUpperCase();
  if (roll < 0.92) return `${text} `; // stray trailing space, as thumbs produce
  if (roll < 0.96) return text.replace(/-/g, ' ');
  // "a hot dog" is a real thing a thumb types; "a cucumber sandwiches" is not.
  const bareSingular = /^[a-z]+$/i.test(text) && !/s$/i.test(text);
  return bareSingular ? `a ${text}` : text;
}

/**
 * How many distinct meanings a room of `n` answerers should spread across.
 * Too many and every group has one member, so every group ties and the log
 * teaches nothing. Roughly one meaning per two players, at least two.
 */
function clusterBudget(n, available) {
  return Math.max(2, Math.min(available, Math.ceil(n / 2)));
}

/**
 * Largest-remainder allocation of `n` answering players across clusters, so a
 * clear majority reliably forms. In tie mode the top two clusters are forced
 * level, which is the case the "every tied largest group scores" rule needs.
 */
function allocate(clusters, n, tie) {
  const counts = new Array(clusters.length).fill(0);
  if (n <= 0) return counts;

  const total = clusters.reduce((sum, c) => sum + c.w, 0);
  const raw = clusters.map((c) => (c.w / total) * n);
  for (let i = 0; i < clusters.length; i += 1) counts[i] = Math.floor(raw[i]);

  let left = n - counts.reduce((a, b) => a + b, 0);
  const byRemainder = raw
    .map((v, i) => ({ rem: v - Math.floor(v), i }))
    .sort((a, b) => b.rem - a.rem);
  for (let k = 0; left > 0; k += 1, left -= 1) counts[byRemainder[k % byRemainder.length].i] += 1;

  if (tie && counts.length >= 2) {
    const target = Math.max(counts[0], counts[1]);
    let need = target - counts[0] + (target - counts[1]);
    counts[0] = target;
    counts[1] = target;
    for (let i = counts.length - 1; i >= 2 && need > 0; i -= 1) {
      const take = Math.min(counts[i], need);
      counts[i] -= take;
      need -= take;
    }
    while (need > 0 && counts[0] > 1 && counts[1] > 1) {
      counts[0] -= 1;
      counts[1] -= 1;
      need -= 2;
    }
    if (need < 0 && counts.length > 2) counts[2] += -need;
    else if (need < 0) counts[0] += -need;
    if (need > 0) counts[0] -= need; // last resort: tie broken, still valid play
  }

  // Never leave the top cluster empty — a round with no majority is not a round.
  if (n > 0 && counts[0] === 0) {
    const donor = counts.findIndex((c) => c > 0);
    if (donor > 0) {
      counts[donor] -= 1;
      counts[0] += 1;
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// 5. Log formatting
// ---------------------------------------------------------------------------

const COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code) => (s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = paint('1');
const dim = paint('2');
const green = paint('32');
const yellow = paint('33');
const cyan = paint('36');
const red = paint('31');
const magenta = paint('35');

const T0 = Date.now();

function stamp() {
  const s = (Date.now() - T0) / 1000;
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = (s % 60).toFixed(1).padStart(4, '0');
  return dim(`${mm}:${ss}`);
}

function out(text = '') {
  console.log(text);
}

function line(text) {
  out(`${stamp()}  ${text}`);
}

function rule(label) {
  const bar = '─'.repeat(Math.max(4, 62 - label.length));
  out(`${stamp()}  ${cyan(`── ${label} ${bar}`)}`);
}

function warnLine(text) {
  out(`${stamp()}  ${yellow('warn')}  ${text}`);
}

function die(message) {
  console.error(`\nsimulate.js: ${message}\n`);
  process.exit(1);
}

function pad(text, width) {
  const s = String(text);
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function padLeft(text, width) {
  const s = String(text);
  return s.length >= width ? s : ' '.repeat(width - s.length) + s;
}

/** Left-hand label column, so every annotation line starts in the same place. */
function tag(label) {
  return pad(label, 10);
}

function truncate(text, max) {
  const s = String(text);
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

// ---------------------------------------------------------------------------
// 6. One simulated phone
// ---------------------------------------------------------------------------

const MAX_RECONNECTS = 3;

/* 600 pairs against a 20-player cap: a phone that clashes this often is not
 * unlucky, it is arguing with a server that disagrees about who holds what. */
const MAX_LOOK_ATTEMPTS = 8;

class SimPlayer {
  constructor(sim, index, name) {
    this.sim = sim;
    this.index = index;
    this.name = name;
    this.playerId = null;
    this.socket = null;
    this.joined = false;
    this.dead = false;
    this.nameAttempt = 0;
    this.answerTimer = null;
    this.reconnects = 0;
    this.warnedError = false;
    // Joining reserves a name; only an accepted look puts this phone in the
    // flock, and an unlocked phone is dropped when the host starts the game.
    this.look = null;
    this.locked = false;
    this.lookSlot = null;
    this.lookAttempt = 0;
  }

  connect() {
    if (this.sim.stopping || this.dead) return;
    const socket = new WebSocket(this.sim.wsUrl);
    this.socket = socket;

    socket.on('open', () => {
      this.reconnects = 0;
      if (this.playerId) this.send({ t: 'player.rejoin', room: this.sim.room, playerId: this.playerId });
      else this.send({ t: 'player.join', room: this.sim.room, name: this.name });
    });

    socket.on('message', (raw) => {
      let frame;
      try {
        frame = JSON.parse(raw.toString('utf8'));
      } catch {
        return;
      }
      this.onFrame(frame);
    });

    socket.on('error', (err) => {
      // One line per phone, not one line per retry — a dead server must not
      // bury the log it is supposed to be producing.
      if (this.sim.stopping || this.warnedError) return;
      this.warnedError = true;
      warnLine(`${this.name}: socket error ${err.message || '(connection refused)'}`);
    });

    socket.on('close', () => {
      this.clearAnswerTimer();
      if (this.sim.stopping || this.dead || this.sim.gameOver) return;
      // A phone that locks its screen comes back — but a server that has gone
      // away must not be hammered forever.
      this.reconnects += 1;
      if (this.reconnects > MAX_RECONNECTS) {
        this.dead = true;
        this.sim.onPlayerLost(this);
        return;
      }
      setTimeout(() => this.connect(), 400 * this.reconnects);
    });
  }

  onFrame(frame) {
    if (!frame || typeof frame.t !== 'string') return;

    if (frame.t === 'joined') {
      const isFirst = !this.joined;
      this.playerId = frame.playerId ?? this.playerId;
      this.joined = true;
      if (isFirst) this.sim.onPlayerJoined(this);
      // A rejoin carries the sheep back, so a phone that already locked in goes
      // straight to the lobby instead of walking into its own pair as a clash.
      if (frame.locked === true && frame.look) this.adoptLook(frame.look, 'restored');
      if (!this.locked) this.pickLook();
      return;
    }

    if (frame.t === 'look.ok') {
      this.adoptLook(frame.look, 'chose');
      return;
    }

    if (frame.t === 'look.taken') {
      this.sim.onLookTaken(frame.taken);
      return;
    }

    if (frame.t === 'error') {
      this.onError(frame);
      return;
    }

    // Every phone sees the same state; Sim dedupes by phase, so any socket may
    // drive the log. That keeps the run alive if one socket drops.
    if (isStateFrame(frame)) this.sim.onState(frame);
  }

  /**
   * Ask for a pair. First call takes the slot this phone's index owns; every
   * later call walks forward, which is how a clash with a real phone already in
   * the room resolves itself instead of taking the simulator down.
   */
  pickLook() {
    if (this.sim.stopping || this.dead) return;
    const from = this.lookSlot === null ? slotForIndex(this.index) : this.lookSlot + 1;
    const slot = this.sim.claimSlot(from);
    if (slot === null) {
      warnLine(`${this.name}: every colour+hat pair is spoken for — cannot join the flock`);
      return;
    }
    this.lookSlot = slot;
    const look = lookForSlot(slot);
    // The pair travels inline on the frame, exactly as the picker sends it.
    if (!this.send({ t: 'player.look', colorId: look.colorId, hatId: look.hatId })) {
      warnLine(`${this.name} could not send a look (socket not open)`);
    }
  }

  /** Record the pair the server confirmed, and keep it out of everyone's scan. */
  adoptLook(look, reason) {
    if (!look || !look.colorId || !look.hatId) return;
    const wasLocked = this.locked;
    this.look = { colorId: look.colorId, hatId: look.hatId };
    this.locked = true;
    this.sim.claimKey(lookKey(this.look));
    if (!wasLocked) this.sim.onPlayerLocked(this, reason);
  }

  onError(frame) {
    const code = frame.code ?? 'BAD_REQUEST';
    if (code === 'LOOK_TAKEN') {
      // Expected, not exceptional: look.taken is advisory and two phones can
      // reach for one pair in the same tick. Take the next free one.
      this.lookAttempt += 1;
      if (this.lookAttempt > MAX_LOOK_ATTEMPTS) {
        warnLine(`${this.name}: gave up choosing after ${MAX_LOOK_ATTEMPTS} clashes — will be dropped at the gate`);
        return;
      }
      // Said out loud: without it, a phone wearing something other than the pair
      // its index owns looks like the assignment is broken.
      const clashed = this.lookSlot === null ? null : lookForSlot(this.lookSlot);
      line(
        dim(
          `${pad(this.name, this.sim.nameWidth)}  clash   ${lookLabel(clashed)} is worn already — taking the next pair`
        )
      );
      this.pickLook();
      return;
    }
    if (code === 'BAD_LOOK') {
      // Both sides import public/shared/look.js. The only way a colour or hat
      // this tool read from it can be unknown is two copies of that file.
      this.dead = true;
      this.sim.fatal(
        `${this.name}: BAD_LOOK — ${frame.message ?? ''}\n` +
          '  This tool and the server disagree about public/shared/look.js.'
      );
      return;
    }
    if (code === 'NOT_LOCKED') {
      this.dead = true;
      warnLine(`${this.name} was dropped at the gate — still choosing when the game started`);
      this.close();
      return;
    }
    if (code === 'NAME_TAKEN' && this.nameAttempt < 3) {
      this.nameAttempt += 1;
      this.name = `${this.name}${randInt(2, 99)}`;
      this.sim.nameWidth = Math.max(this.sim.nameWidth, this.name.length);
      this.send({ t: 'player.join', room: this.sim.room, name: this.name });
      return;
    }
    if (code === 'ROOM_NOT_FOUND') {
      this.dead = true;
      this.sim.fatal(`room "${this.sim.room}" does not exist on ${this.sim.origin}. Open the display first, or use --auto-create.`);
      return;
    }
    if (code === 'ROOM_FULL' || code === 'GAME_STARTED') {
      this.dead = true;
      warnLine(`${this.name} could not join: ${code} — ${frame.message ?? ''}`);
      this.close();
      return;
    }
    warnLine(`${this.name}: ${code} — ${frame.message ?? ''}`);
  }

  send(frame) {
    if (this.socket && this.socket.readyState === 1) {
      this.socket.send(JSON.stringify(frame));
      return true;
    }
    return false;
  }

  clearAnswerTimer() {
    if (this.answerTimer) {
      clearTimeout(this.answerTimer);
      this.answerTimer = null;
    }
  }

  close() {
    this.clearAnswerTimer();
    if (this.socket) {
      try {
        this.socket.close(1000, 'simulator done');
      } catch {
        try {
          this.socket.terminate();
        } catch {
          /* already gone */
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 7. The simulator
// ---------------------------------------------------------------------------

function isStateFrame(frame) {
  if (frame.t === 'state') return true;
  // Defensive: treat any frame carrying a phase and a players array as state,
  // so a server that omits the envelope tag still drives the simulator.
  return typeof frame.phase === 'string' && Array.isArray(frame.players);
}

class Sim {
  constructor(opts) {
    this.opts = opts;
    this.origin = opts.url;
    this.wsUrl = socketUrl(opts.url);
    this.room = opts.room;
    this.players = [];
    this.byId = new Map();
    this.host = null;
    this.stopping = false;
    this.started = false;
    this.gameOver = false;
    this.startTimer = null;
    this.stateWatchdog = null;
    this.sawState = false;
    this.lastPhaseKey = null;
    this.round = null; // current round plan
    this.nameWidth = 4;
    this.lobbyReported = '';
    // Slots and pairs this run has spoken for. Claimed at request time, not on
    // the reply, so two phones picking in the same tick cannot both take one.
    this.claimedSlots = new Set();
    this.claimedKeys = new Set();
    // Everything the server says is worn, including looks belonging to real
    // phones in the room that this process knows nothing else about.
    this.serverTaken = new Set();
  }

  /**
   * A joined phone that never receives a `state` frame is the single most
   * confusing failure to debug, so name it out loud rather than sitting silent.
   */
  armStateWatchdog(ms, what) {
    if (this.sawState || this.stateWatchdog) return;
    const timer = setTimeout(() => {
      this.stateWatchdog = null;
      if (this.sawState || this.stopping) return;
      out('');
      warnLine(`${bold('no state frames')} — ${what}`);
      warnLine(dim("The join was accepted but the server has broadcast no { t:'state', … } frame."));
      warnLine(dim('Nothing can be simulated without it: phase, question and endsAt all come from state.'));
      warnLine(dim('Leaving the sockets open in case it starts. Ctrl-C to stop.'));
      out('');
    }, ms);
    this.stateWatchdog = timer;
  }

  clearStateWatchdog() {
    if (this.stateWatchdog) {
      clearTimeout(this.stateWatchdog);
      this.stateWatchdog = null;
    }
  }

  // ---- lifecycle ----------------------------------------------------------

  async run() {
    out('');
    out(bold('  Flock Together — headless player simulator'));
    out(dim(`  server ${this.origin}   socket ${this.wsUrl}`));
    out(
      dim(
        `  players ${this.opts.players}   miss ${this.opts.miss}   slow ${this.opts.slow}` +
          (this.opts.seed !== null ? `   seed ${this.opts.seed}` : '')
      )
    );
    out('');

    if (this.opts.autoCreate) await this.createRoom();
    else line(`joining room ${bold(this.room)}`);

    this.spawnPlayers();
  }

  createRoom() {
    return new Promise((resolve) => {
      const socket = new WebSocket(this.wsUrl);
      this.host = socket;
      let settled = false;

      const failFast = setTimeout(() => {
        if (!settled) this.fatal(`no response from ${this.origin} — is the server running? (npm start)`);
      }, 10_000);

      socket.on('open', () => socket.send(JSON.stringify({ t: 'host.create' })));

      socket.on('message', (raw) => {
        let frame;
        try {
          frame = JSON.parse(raw.toString('utf8'));
        } catch {
          return;
        }
        if (frame.t === 'room.created') {
          clearTimeout(failFast);
          settled = true;
          this.room = frame.room;
          line(`room ${bold(frame.room)} created`);
          line(`join URL  ${cyan(frame.joinUrl ?? `${this.origin}/play?room=${frame.room}`)}`);
          line(`display   ${cyan(`${this.origin}/`)}`);
          resolve();
          return;
        }
        if (frame.t === 'error') {
          warnLine(`host: ${frame.code} — ${frame.message ?? ''}`);
          return;
        }
        // The host connection carries display state (no `you` block).
        if (isStateFrame(frame)) this.onState(frame);
      });

      socket.on('error', (err) => {
        clearTimeout(failFast);
        const why = err?.message || err?.code || 'connection refused';
        if (!this.stopping) this.fatal(`could not reach ${this.wsUrl} (${why}). Is the server running?`);
      });

      socket.on('close', () => {
        if (this.stopping || this.gameOver) return;
        warnLine('host socket closed by the server — nothing left to drive the game');
        this.shutdown(1);
      });
    });
  }

  spawnPlayers() {
    const chosen = new Set();
    for (let i = 0; i < this.opts.players; i += 1) {
      const name = nameFor(i, chosen);
      chosen.add(name);
      const player = new SimPlayer(this, i, name);
      this.players.push(player);
      this.nameWidth = Math.max(this.nameWidth, name.length);
    }
    // Stagger connections slightly — arriving all at once is not how a party works.
    this.players.forEach((player, i) => {
      setTimeout(() => player.connect(), i * 120);
    });
  }

  onPlayerLost(player) {
    warnLine(`${player.name} gave up after ${MAX_RECONNECTS} reconnect attempts`);
    const alive = this.players.filter((p) => !p.dead).length;
    if (alive === 0 && !this.gameOver) {
      this.fatal('every simulated phone lost its socket — is the server still running?');
    }
  }

  // ---- looks --------------------------------------------------------------

  /**
   * The first slot at or after `from` that this run has not claimed and the
   * server has not reported worn. Returns null only if all 600 pairs are gone.
   */
  claimSlot(from) {
    for (let step = 0; step < LOOK_COMBINATIONS; step += 1) {
      const slot = (from + step) % LOOK_COMBINATIONS;
      if (this.claimedSlots.has(slot)) continue;
      const key = lookKey(lookForSlot(slot));
      if (this.claimedKeys.has(key) || this.serverTaken.has(key)) continue;
      this.claimedSlots.add(slot);
      this.claimedKeys.add(key);
      return slot;
    }
    return null;
  }

  claimKey(key) {
    if (key) this.claimedKeys.add(key);
  }

  /**
   * Advisory only, exactly as the picker treats it: the server still rejects a
   * race with LOOK_TAKEN. Tracking it just keeps this tool from reaching for a
   * pair somebody already wears.
   */
  onLookTaken(taken) {
    if (!Array.isArray(taken)) return;
    this.serverTaken = new Set(taken.filter((key) => typeof key === 'string' && key));
  }

  // ---- arrivals -----------------------------------------------------------

  onPlayerJoined(player) {
    this.byId.set(player.playerId, player);
    const joined = this.players.filter((p) => p.joined).length;
    line(`${pad(player.name, this.nameWidth)}  ${dim('joined')}  ${dim(`(${joined}/${this.opts.players})`)}`);

    if (!this.opts.autoCreate) {
      this.armStateWatchdog(15_000, `${joined} phone(s) joined room ${this.room} and heard nothing back`);
      return;
    }
    // Armed on the first JOIN, not the first look: a room where nothing is ever
    // accepted must still reach host.start and say why it cannot start.
    this.armStartFallback();
  }

  /**
   * A confirmed look is what makes a player real, so the game waits on locked
   * phones rather than joined ones — the server would drop the difference.
   */
  onPlayerLocked(player, reason) {
    const locked = this.players.filter((p) => p.locked).length;
    line(
      `${pad(player.name, this.nameWidth)}  ${dim(pad(reason, 8))}` +
        `${cyan(pad(lookLabel(player.look), LOOK_WIDTH))}  ` +
        `${dim(`(${locked}/${this.opts.players} in the flock)`)}`
    );

    if (!this.opts.autoCreate || this.started) return;
    if (locked < this.opts.players) return;
    // The whole flock is dressed: no reason to wait out the fallback.
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = setTimeout(() => this.startGame(), 400);
  }

  /** Never hang on a phone that failed to join or never got a look accepted. */
  armStartFallback() {
    if (this.startTimer || this.started) return;
    this.startTimer = setTimeout(() => {
      const locked = this.players.filter((p) => p.locked).length;
      warnLine(
        `only ${locked}/${this.opts.players} phones picked a look — starting anyway; ` +
          'anyone still choosing is dropped at the gate'
      );
      this.startGame();
    }, 20_000);
  }

  startGame() {
    if (this.started || this.stopping) return;
    const locked = this.players.filter((p) => p.locked).length;
    if (locked < 2) {
      this.fatal(`only ${locked} player(s) confirmed a look; the server needs at least 2 in the flock to start.`);
      return;
    }
    this.started = true;
    line(`${magenta('host.start')} with ${locked} in the flock`);
    try {
      this.host.send(JSON.stringify({ t: 'host.start', room: this.room }));
    } catch (err) {
      this.fatal(`could not send host.start: ${err.message}`);
      return;
    }
    this.armStateWatchdog(12_000, `host.start was sent for room ${this.room} and no round began`);
  }

  fatal(message) {
    if (this.stopping) return;
    console.error(`\n${red('simulate.js')} ${message}\n`);
    this.shutdown(1);
  }

  shutdown(code = 0) {
    if (this.stopping) return;
    this.stopping = true;
    this.clearStateWatchdog();
    if (this.startTimer) clearTimeout(this.startTimer);
    for (const player of this.players) player.close();
    if (this.host) {
      try {
        this.host.close(1000, 'simulator done');
      } catch {
        /* nothing to do */
      }
    }
    // Not unref'd on purpose: this timer is what keeps the loop alive long
    // enough for the close frames to go out, and it owns the exit code.
    setTimeout(() => process.exit(code), 250);
  }

  // ---- state ------------------------------------------------------------

  onState(frame) {
    this.sawState = true;
    this.clearStateWatchdog();
    const phase = frame.phase;
    const key = `${phase}:${frame.roundIndex ?? 0}:${frame.scoreboardReason ?? ''}`;
    const isNew = key !== this.lastPhaseKey;
    this.lastPhaseKey = key;

    if (phase === 'lobby') {
      // players[] is the flock — locked phones only. `choosing` is everyone
      // still in the picker, and it is the pair of numbers that explains a
      // lobby the display refuses to start.
      const flock = Array.isArray(frame.players) ? frame.players.length : 0;
      const choosing = Number(frame.choosing) || 0;
      const key = `${flock}/${choosing}`;
      if (key === this.lobbyReported) return;
      this.lobbyReported = key;
      const joined = this.players.filter((p) => p.joined).length;
      if (this.opts.autoCreate || joined < this.opts.players) return;
      if (choosing > 0) line(dim(`lobby: flock of ${flock}, ${choosing} still choosing`));
      else line(dim(`lobby: flock of ${flock} — waiting for the display to start the game`));
      return;
    }

    if (!isNew) return;

    switch (phase) {
      case 'question':
        this.onQuestion(frame);
        break;
      case 'grouping':
        line(dim('gate shut — grouping in flight'));
        break;
      case 'reveal':
        this.onReveal(frame);
        break;
      case 'scores':
        this.onScores(frame);
        break;
      case 'final':
        this.onFinal(frame);
        break;
      default:
        line(dim(`phase ${phase}`));
    }
  }

  // ---- the round --------------------------------------------------------

  onQuestion(frame) {
    for (const player of this.players) player.clearAnswerTimer();

    const roundNo = (frame.roundIndex ?? 0) + 1;
    const total = frame.totalRounds ?? '?';
    const endsAt = Number(frame.endsAt) || Date.now() + 45_000;
    const msLeft = Math.max(0, endsAt - Date.now());

    out('');
    rule(`round ${roundNo}/${total}`);
    line(`${bold(frame.question ?? '(no question)')}  ${dim(`${Math.round(msLeft / 1000)}s`)}`);

    // Locked, not merely joined: the server dropped anyone still choosing when
    // the game started, so an unlocked phone has no player record to answer for.
    const live = this.players.filter((p) => p.locked && !p.dead);
    const { clusters: pool, keyed } = clustersFor(frame.question);

    // Roles for this round.
    const order = shuffled(live);
    const missers = order.slice(0, Math.min(this.opts.miss, order.length));
    const rest = order.slice(missers.length);
    const slowOnes = rest.slice(0, Math.min(this.opts.slow, rest.length));
    const slowSet = new Set(slowOnes);

    // Intent: which meaning each answering player will land on.
    const clusters = pool.slice(0, clusterBudget(rest.length, pool.length));
    const tie = rnd() < 0.2;
    const counts = allocate(clusters, rest.length, tie);
    const bag = [];
    counts.forEach((n, i) => {
      for (let k = 0; k < n; k += 1) bag.push(i);
    });
    const assignment = shuffled(bag);

    const intent = new Map(); // playerId -> cluster label
    const plan = [];
    rest.forEach((player, i) => {
      const cluster = clusters[assignment[i] ?? 0];
      const text = mutate(pick(cluster.forms)).slice(0, 60);
      intent.set(player.playerId, cluster.label);
      plan.push({ player, cluster, text, slow: slowSet.has(player) });
    });

    const intentSummary = counts
      .map((n, i) => (n > 0 ? `${clusters[i].label}x${n}` : null))
      .filter(Boolean)
      .join('  ');

    // Report the tie the allocation actually produced, not the one it wanted:
    // two clusters and an odd number of answerers cannot be split level.
    const tied = counts.length >= 2 && counts[0] > 0 && counts[0] === counts[1];

    line(
      dim(
        `${tag('intent')}${intentSummary || '(nobody answering)'}   ` +
          `[${keyed ? 'keyed answers' : 'generic pool'}${tied ? `, TIE at ${counts[0]}` : ''}` +
          `${missers.length ? `, ${missers.length} sitting out` : ''}` +
          `${slowOnes.length ? `, ${slowOnes.length} late` : ''}]`
      )
    );

    // Sitters produce no answer line, so their sheep is named here instead —
    // every phone in the round is accounted for with the look it is wearing.
    if (missers.length > 0) {
      line(dim(`${tag('sit out')}${missers.map((p) => `${p.name} (${lookLabel(p.look)})`).join(', ')}`));
    }

    this.round = {
      roundNo,
      question: frame.question,
      endsAt,
      intent,
      submitted: new Map(), // playerId -> text
      missers: missers.map((p) => p.name),
    };

    for (const item of plan) {
      const remaining = Math.max(0, this.round.endsAt - Date.now());
      const delay = item.slow ? slowDelay(remaining) : normalDelay(remaining);
      item.player.answerTimer = setTimeout(() => {
        item.player.answerTimer = null;
        this.submit(item);
      }, delay);
    }
  }

  submit(item) {
    const { player, text, slow } = item;
    if (this.stopping || !this.round) return;
    const ok = player.send({ t: 'player.answer', text });
    if (!ok) {
      warnLine(`${player.name} could not send an answer (socket not open)`);
      return;
    }
    this.round.submitted.set(player.playerId, text);
    if (this.opts.quiet) return;
    const left = Math.max(0, this.round.endsAt - Date.now());
    // The look rides along on every answer: names identify a phone, but only the
    // colour+hat pair identifies the sheep a developer is watching on the TV.
    line(
      `${pad(player.name, this.nameWidth)}  ${dim('->')} ${pad(`"${text}"`, 26)} ` +
        `${dim(pad(lookLabel(player.look), LOOK_WIDTH))}  ` +
        `${dim(`${(left / 1000).toFixed(1)}s left`)}${slow ? ` ${yellow('late')}` : ''}`
    );
  }

  // ---- reveal -----------------------------------------------------------

  onReveal(frame) {
    const groups = Array.isArray(frame.groups) ? frame.groups : [];
    const noAnswer = Array.isArray(frame.noAnswer) ? frame.noAnswer : [];
    const source = frame.groupingSource ?? 'unknown';

    out('');
    rule(`reveal — grouping: ${source === 'fallback' ? yellow(source) : green(source)}`);

    if (groups.length === 0) {
      line(dim('no groups — nobody answered'));
    } else {
      const sizeWidth = 2;
      const labelWidth = Math.min(
        26,
        Math.max(8, ...groups.map((g) => String(g.label ?? '').length))
      );
      // marker(4) + gap + size + 2 gaps + label + 2 gaps
      const gutter = ' '.repeat(4 + 1 + sizeWidth + 2 + labelWidth + 2);

      groups.forEach((group, i) => {
        const size = Array.isArray(group.answers) ? group.answers.length : 0;
        const texts = (group.answers ?? []).map((a) => a.text).join(' / ');
        const names = (group.answers ?? []).map((a) => a.name).join(', ');
        const marker = group.scored ? green(bold('WIN ')) : dim(' -  ');
        out(
          `${stamp()}  ${marker} ${padLeft(size, sizeWidth)}  ` +
            `${pad(truncate(group.label ?? '', labelWidth), labelWidth)}  ` +
            `${truncate(texts, 58)}`
        );
        out(`${stamp()}  ${gutter}${dim(truncate(names, 58))}`);
        if (i === groups.length - 1) out('');
      });
    }

    if (noAnswer.length > 0) {
      line(
        `${yellow(tag('no answer'))}${truncate(noAnswer.map((n) => n.name).join(', '), 96)}  ` +
          `${dim(`(${noAnswer.length})`)}`
      );
    }
    this.checkNoAnswer(noAnswer);
    this.gradeGrouping(groups);
    this.scoreLine(frame.players);
  }

  /**
   * The non-submitter rule, checked rather than assumed: exactly the phones the
   * simulator told to sit out should come back in noAnswer[].
   */
  checkNoAnswer(noAnswer) {
    const round = this.round;
    if (!round) return;
    // Only judge phones this process controls: a real human in the room, or a
    // leftover player from an earlier run, is not a bug in the server.
    const ours = new Set(this.players.map((p) => p.name));
    const listed = new Set(noAnswer.map((n) => n.name).filter((n) => ours.has(n)));
    const submittedNames = new Set(
      this.players.filter((p) => round.submitted.has(p.playerId)).map((p) => p.name)
    );

    const missing = round.missers.filter((n) => !listed.has(n));
    const wrongly = [...listed].filter((n) => submittedNames.has(n));
    if (missing.length === 0 && wrongly.length === 0) return;

    const parts = [];
    if (missing.length) parts.push(`sat out but absent from noAnswer[]: ${missing.join(', ')}`);
    if (wrongly.length) parts.push(`in noAnswer[] but did submit: ${wrongly.join(', ')}`);
    warnLine(`noAnswer mismatch — ${parts.join('; ')}`);
  }

  /**
   * The whole point of the tool: did the grouper put answers the simulator
   * MEANT as one meaning into one group, and keep different meanings apart?
   */
  gradeGrouping(groups) {
    const round = this.round;
    if (!round || groups.length === 0) return;

    const mixed = [];
    const groupsPerIntent = new Map(); // intent label -> Set of group indexes

    groups.forEach((group, gi) => {
      const seen = new Set();
      for (const answer of group.answers ?? []) {
        const label = round.intent.get(answer.playerId);
        if (!label) continue;
        seen.add(label);
        if (!groupsPerIntent.has(label)) groupsPerIntent.set(label, new Set());
        groupsPerIntent.get(label).add(gi);
      }
      if (seen.size > 1) mixed.push(`#${gi + 1} mixes ${[...seen].join(' + ')}`);
    });

    const split = [...groupsPerIntent.entries()]
      .filter(([, set]) => set.size > 1)
      .map(([label, set]) => `${label} split across ${set.size} groups`);

    const problems = [...mixed, ...split];
    if (problems.length === 0) line(green(`${tag('check')}grouping matches the simulated intent exactly`));
    else line(`${yellow(tag('check'))}${problems.join('; ')}`);
  }

  scoreLine(players) {
    if (!Array.isArray(players) || players.length === 0) return;
    const sorted = [...players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || String(a.name).localeCompare(String(b.name)));
    const cells = sorted.map((p) => `${p.name} ${bold(p.score ?? 0)}`);
    line(`${dim(tag('scores'))}${cells.join(dim('  |  '))}`);
  }

  scoreTable(players, heading) {
    const sorted = [...players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || String(a.name).localeCompare(String(b.name)));
    const width = Math.max(4, ...sorted.map((p) => String(p.name).length));
    out('');
    rule(heading);
    let rank = 0;
    let lastScore = null;
    sorted.forEach((p, i) => {
      if (p.score !== lastScore) {
        rank = i + 1;
        lastScore = p.score;
      }
      const leader = rank === 1 ? green(bold('*')) : ' ';
      const flags = [];
      if (p.connected === false) flags.push(dim('offline'));
      out(
        (
          `${stamp()}  ${leader} ${padLeft(rank, 2)}.  ${pad(p.name, width)}  ` +
          `${padLeft(p.score ?? 0, 3)}  ${flags.join(' ')}`
        ).trimEnd()
      );
    });
    out('');
  }

  onScores(frame) {
    const reason = frame.scoreboardReason ?? 'unknown';
    this.scoreTable(frame.players ?? [], `SCOREBOARD (${reason})`);
  }

  onFinal(frame) {
    this.gameOver = true;
    this.scoreTable(frame.players ?? [], 'FINAL');
    const players = frame.players ?? [];
    const top = Math.max(0, ...players.map((p) => p.score ?? 0));
    const winners = players.filter((p) => (p.score ?? 0) === top).map((p) => p.name);
    line(`${green(bold('winner' + (winners.length > 1 ? 's' : '')))}  ${winners.join(', ')} with ${top}`);
    line(dim('game over — closing sockets'));
    setTimeout(() => this.shutdown(0), 1500);
  }
}

// ---------------------------------------------------------------------------
// 8. Answer timing
// ---------------------------------------------------------------------------

/** Random, but always landing at least ~1s before the gate shuts. */
function normalDelay(msLeft) {
  const latest = msLeft - 1000;
  if (latest <= 200) return Math.max(0, Math.floor(msLeft * 0.4));
  const earliest = Math.min(1500, latest);
  return randInt(earliest, latest);
}

/** Inside the last 2 seconds, still before the gate. */
function slowDelay(msLeft) {
  const latest = msLeft - 1000;
  if (latest <= 200) return Math.max(0, Math.floor(msLeft * 0.6));
  const earliest = Math.max(0, Math.min(msLeft - 2000, latest));
  return randInt(earliest, latest);
}

// ---------------------------------------------------------------------------
// 9. Go
// ---------------------------------------------------------------------------

const opts = parseArgs(process.argv.slice(2));
const sim = new Sim(opts);

let interrupted = false;
function onSignal(name) {
  if (interrupted) process.exit(1);
  interrupted = true;
  out('');
  line(dim(`${name} — closing ${sim.players.length} sockets`));
  sim.shutdown(0);
}
process.on('SIGINT', () => onSignal('SIGINT'));
process.on('SIGTERM', () => onSignal('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  warnLine(`unhandled rejection: ${reason}`);
});

await sim.run();
