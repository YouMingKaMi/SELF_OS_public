export function noteParts(note: string) {
  return note
    .split(/(https?:\/\/[^\s<>"“”。，；！？、]+)/giu)
    .map((text, i) => {
      if (i % 2 === 0) return { text };
      try {
        const url = new URL(text);
        if (url.protocol === "http:" || url.protocol === "https:")
          return { text, href: url.href };
      } catch {
        // Keep incomplete links as plain text.
      }
      return { text };
    });
}

export const readingLink = (text: string) =>
  noteParts(text).find((part) => part.href)?.href;
