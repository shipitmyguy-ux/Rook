// Reuse unchanged cards, including lazy images and resolved distance panels.
export function createCardRenderer() {
  const cards = new Map();
  let emptyHtml = null;
  return (container, rows, renderCard, empty = "") => {
    if (!rows.length) {
      if (cards.size || emptyHtml !== empty) container.innerHTML = empty;
      cards.clear(); emptyHtml = empty;
      return;
    }
    if (emptyHtml !== null) { container.replaceChildren(); emptyHtml = null; }
    const alive = new Set();
    let cursor = container.firstElementChild;
    for (const row of rows) {
      const id = String(row.id), html = renderCard(row);
      alive.add(id);
      let card = cards.get(id);
      if (!card || card.html !== html) {
        const template = container.ownerDocument.createElement("template");
        template.innerHTML = html;
        const node = template.content.firstElementChild;
        if (card) card.node.replaceWith(node);
        if (cursor === card?.node) cursor = node;
        card = { html, node }; cards.set(id, card);
      }
      if (card.node !== cursor) container.insertBefore(card.node, cursor);
      cursor = card.node.nextElementSibling;
    }
    for (const [id, card] of cards) if (!alive.has(id)) { card.node.remove(); cards.delete(id); }
  };
}
