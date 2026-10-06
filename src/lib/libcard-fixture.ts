// Checked-in, fictional/offline LibCard config. Never fetched from the configured repo in demo mode.
export const libcardFixture = `
profile:
  name: Alex Morgan
  tagline: Making room for good things, together.
  location: Portland, Oregon
links:
  - label: Presence
    url: https://example.com/presence
    feedme: { id: presence, blurb: More time listening and coaching., aspiration: 3000 }
  - label: Nervous system
    url: https://example.com/nervous-system
    feedme: { id: nervous-system, blurb: Experiments in feeling at home. }
  - label: Pirate age
    url: https://example.com/pirate-age
    feedme: { id: pirate-age, blurb: Essays about a different kind of future. }
  - label: xNet
    url: https://example.com/xnet
    feedme: { id: xnet, blurb: Building tools that belong to their communities. }
  - label: Résumé
    url: https://example.com/resume.pdf
  - label: Rabbit holes
    url: https://example.com/rabbit-holes
socials:
  - platform: x
    url: https://example.com/social
    feedme: { id: x, blurb: More of this voice. }
  - platform: github
    url: https://github.com/example
blocks:
  - type: text
    markdown: These are the things I’m curious about. Your picks help me hear what resonates.
`;
