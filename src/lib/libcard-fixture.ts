// Checked-in, fictional/offline LibCard config. Never fetched from the configured repo in demo mode.
export const libcardFixture = `
profile:
  name: Alex Rivers
  tagline: Making room for good things, together.
  location: Portland, Oregon
links:
  - label: Presence
    url: https://example.com/presence
    icon: heart
    status: ready
    feedme: { id: presence, blurb: More time listening and coaching., aspiration: 3000 }
  - label: Nervous system
    url: https://example.com/nervous-system
    icon: activity
    status: ready
    feedme: { id: nervous-system, blurb: Experiments in feeling at home. }
  - label: Pirate age
    url: https://example.com/pirate-age
    icon: book-open
    status: writing
    feedme: { id: pirate-age, blurb: Essays about a different kind of future. }
  - label: xNet
    url: https://example.com/xnet
    icon: network
    status: wip
    feedme: { id: xnet, blurb: Building tools that belong to their communities. }
  - label: Résumé
    url: https://example.com/resume.pdf
    icon: file-text
    status: dormant
  - label: Rabbit holes
    url: https://example.com/rabbit-holes
    icon: book-open
    status: reading
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
