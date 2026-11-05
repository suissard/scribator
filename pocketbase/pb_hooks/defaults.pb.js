/// <reference path="../pb_data/types.d.ts" />

// PocketBase n'a pas de valeurs par défaut sur les champs : le client n'ayant pas le droit
// d'envoyer `status`, c'est ici que l'état initial est posé.

onRecordCreate((e) => {
  if (!e.record.getString("status")) e.record.set("status", "STEP_1_INPUT");
  e.next();
}, "projects");

onRecordCreate((e) => {
  if (!e.record.getString("role")) e.record.set("role", "member");
  if (!e.record.getFloat("monthly_budget_usd")) e.record.set("monthly_budget_usd", 10);
  e.next();
}, "users");
