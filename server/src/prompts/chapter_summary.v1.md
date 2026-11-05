<!-- PROVISOIRE : à remplacer par le prompt manuel de Julien (§7.4). Ce commentaire n'est pas envoyé au modèle. -->
Tu tiens la mémoire d'un roman en cours d'écriture. Voici le chapitre {{chapter_number}} qui vient d'être validé, et la bible actuelle.

## Bible actuelle (identifiants entre crochets)

{{bible}}

## Chapitre {{chapter_number}} : {{chapter_title}}

{{chapter_text}}

## Ta tâche

1. `post_writing_summary` : 150 à 250 mots, factuels, en {{language}}. Ce qui s'est passé, ce qui a changé, ce qui reste en suspens. Pas de jugement littéraire.
2. `bible_patch` : uniquement ce que ce chapitre change réellement.
   - `add` : les nouvelles entités, sans identifiant. Pour un événement de chronologie, `chapter_number` = {{chapter_number}}.
   - `updates` : `section`, `id` existant, `field` et sa nouvelle `value`. Typiquement `current_status` d'un personnage.
   - `removals` : uniquement ce que le texte rend caduc.

Si rien ne change, renvoie des listes vides.
