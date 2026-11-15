// Entry point. Two separate UI trees, chosen once at startup:
//   Supabase configured → the MT-2 app in src/v2 (design stylesheet only).
//   No Supabase env     → the MT-1 prototype on the in-browser mock (e2e runs here).
// Their class names collide, so each tree imports its own CSS and this file imports none.

import { supabase } from './api/supabase'

// Keep this shape: one loader per tree, called through the table. Written as
// `if (supabase) import(a) else import(b)`, the production build folds the two imports
// into one preload call and v2 gets the old tree's stylesheet instead of its own.
const trees = {
  v2: () => import('./v2/main'),
  legacy: () => import('./legacyMain'),
}

void trees[supabase ? 'v2' : 'legacy']()
