/*
 * questions.js — the question pack for Flock Together.
 *
 * PROVENANCE: these questions are ORIGINAL CONTENT AUTHORED FOR THIS PROTOTYPE.
 * PRODUCT.md ("Evidence on Hand") records that there is no real content, no play
 * transcripts and no prior art on hand for this product. Nothing in this file is
 * taken from a published game, and nothing here should be presented to a viewer
 * as real play data. Any example answers shown in the UI must be labelled as
 * authored too.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DESIGN RULE — MAJORITY CONVERGENCE. Read this before adding a question.
 * ─────────────────────────────────────────────────────────────────────────────
 * A point is scored by answering with the MAJORITY, not by being right or clever.
 * So a question is only good if a room of 10-20 people will pile onto a small
 * number of obvious-ish answers, while still leaving real room to guess wrong.
 * Aim for roughly 3-8 plausible clusters.
 *
 *   GOOD  "Name a hot beverage."                  -> tea / coffee dominate, but
 *                                                    hot chocolate is a trap
 *         "Name something in a hotel bathroom."    -> tiny soap, towels, shampoo
 *         "Name a sandwich that starts an argument."
 *
 *   BAD   "Name a word."            -> infinite answers, no majority can form
 *         "Describe your childhood." -> not clusterable, not typable one-handed
 *         "What is the capital of France?" -> one right answer, everybody scores,
 *                                            no game
 *
 * Every question must also be:
 *   - ONE sentence, under ~70 characters, so it sets huge on the shared display;
 *   - answerable in 1-3 words typed with one thumb on a phone;
 *   - safe with mixed company including relatives: no sexual content, no slurs,
 *     nothing that singles out or embarrasses a specific player in the room, and
 *     no niche regional, political or pop-culture knowledge required.
 *
 * Prefer plain, widely-shared vocabulary over regional words (say "gas station"
 * or avoid the category entirely rather than picking a side on "petrol").
 *
 * The sections below are for human editors only — the module exports ONE FLAT
 * ARRAY of strings. The engine owns shuffling and round selection; do not
 * pre-shuffle here, and keep the pack comfortably larger than DEFAULT_ROUNDS so
 * a game never repeats a question.
 */

const QUESTIONS = [
  // — Concrete categories (safest; these always land) —
  'Name a hot beverage.',
  'Name a yellow fruit.',
  'Name a green vegetable.',
  'Name a farm animal.',
  'Name a big cat.',
  'Name a bird you see in a garden.',
  'Name a jungle animal.',
  'Name a dog breed.',
  'Name a planet.',
  'Name a type of pasta.',
  'Name a type of bread.',
  'Name a type of cheese.',
  'Name an ice cream flavor.',
  'Name a pizza topping.',
  'Name a fizzy drink.',
  'Name a flower.',
  'Name a musical instrument in an orchestra.',
  'Name a sport played with a ball.',
  'Name a school subject.',
  'Name a card game.',
  'Name a board game.',
  'Name a shape.',
  'Name a bone in the human body.',
  'Name a type of hat.',
  'Name a kitchen appliance.',

  // — Everyday places and containers (concrete, but the room has to guess) —
  'Name something in a hotel bathroom.',
  'Name something in a first aid kit.',
  'Name something in a toolbox.',
  'Name something in a pencil case.',
  'Name something in a picnic basket.',
  'Name something in a vending machine.',
  'Name something on your desk right now.',
  'Name something in the door of your fridge.',
  'Name something you take to the beach.',
  'Name something you wear in the rain.',
  'Name something you see at the dentist.',
  'Name a spice that lives in every kitchen.',
  'Name something that comes in a tin.',
  'Name something people put on toast.',
  'Name a drawer that every home has.',
  'Name something in your pocket or bag.',
  'Name a piece of camping gear.',

  // — Observed life (the room's shared experience is the answer) —
  'Name something you always lose.',
  'Name a chore nobody wants to do.',
  'Name something you would never lend out.',
  'Name an excuse for being late.',
  'Name something people do to look busy.',
  'Name a book people pretend to have read.',
  'Name a sound that wakes you up.',
  'Name something people forget to pack.',
  'Name a reason to leave a party early.',
  'Name what people say when the wifi dies.',
  'Name something you use only once a year.',
  'Name something people keep for far too long.',
  'Name a smell that means home.',
  'Name something people say to a dog.',
  'Name what you cook when you cannot be bothered.',
  'Name something you do while on hold.',
  'Name a snack you eat standing up.',
  'Name the first thing you do in the morning.',
  'Name something that is always broken at work.',
  'Name something you would grab in a fire.',
  'Name a rule that everybody breaks.',
  'Name the worst time for the phone to ring.',

  // — Mild opinion (the room's consensus IS the joke) —
  'Name a sandwich that starts an argument.',
  'Name something people are irrationally afraid of.',
  'Name the best day of the week.',
  'Name a food that is better cold.',
  'Name a topping that ruins a pizza.',
  'Name the most useless kitchen gadget.',
  'Name the worst seat on a plane.',
  'Name a superpower everyone would pick.',
  'Name an animal you would lose a fight to.',
  'Name the most annoying sound in the world.',
  'Name a gift that nobody wants.',
  'Name a job that looks fun but is not.',
  'Name the best free thing in a hotel room.',
  'Name a word people always misspell.',
  'Name something that never looks like the photo.',
  'Name a food you would refuse to share.',
  'Name something everyone claims to like.',
  'Name the worst weather to walk in.',

  // — Playfully absurd (still needs an obvious-ish majority) —
  'Name an animal that would be a terrible driver.',
  'Name an animal you would hire as a bodyguard.',
  'Name a bad name for a boat.',
  'Name a bad name for a racehorse.',
  'Name a bad flavor for toothpaste.',
  'Name something a wizard keeps in his pockets.',
  'Name a terrible superpower to be given.',
  'Name a job a bear could do well.',
  'Name something a robot would get wrong.',
  'Name an animal that would win a talent show.',
  'Name a terrible theme for a wedding.',
  'Name something ghosts would complain about.',
  'Name a food a dinosaur would order.',
  'Name the one thing to take to a desert island.',
  'Name the worst animal to keep in an apartment.',
];

export default QUESTIONS;
