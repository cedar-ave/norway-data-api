// Dataset served by the Norway Data API sample (see norway-data.mjs and
// public/openapi/norway-data.yaml). Plain module data, so the function has
// no database or external calls and every response is deterministic.
//
// IDs are part of the API contract (the docs promise they never change or
// get reused): add new facts with the next integer ID, and give new places
// a slug of their name. Every placeIds entry must match a place below - the
// contract test checks this.

export const categories = [
  { id: 'geography', name: 'Geography', description: 'Mountains, fjords, glaciers, lakes, and borders.' },
  { id: 'history', name: 'History', description: 'Independence, the constitution, exploration, and politics.' },
  { id: 'culture', name: 'Culture', description: 'Language, art, literature, food, and outdoor life.' },
  { id: 'nature', name: 'Nature', description: 'Wildlife, light, and the Arctic.' },
  { id: 'economy', name: 'Economy', description: 'Energy, industry, and public finance.' },
];

export const facts = [
  { id: 1, category: 'geography', title: 'A very long coastline', text: 'Counting every fjord, mainland Norway has about 25,000 km of coastline. Including its islands, the total is about 100,000 km.', placeIds: [] },
  { id: 2, category: 'geography', title: 'The king of fjords', text: 'Sognefjord is the longest and deepest fjord in Norway, at about 205 km long and over 1,300 m deep.', placeIds: ['sognefjord'] },
  { id: 3, category: 'geography', title: 'Highest peak in Northern Europe', text: 'Galdhøpiggen in Jotunheimen is 2,469 m tall, making it the highest mountain in Norway and in Northern Europe.', placeIds: ['galdhopiggen', 'jotunheimen'] },
  { id: 4, category: 'geography', title: 'Three land neighbors', text: 'Norway shares land borders with Sweden, Finland, and Russia.', placeIds: [] },
  { id: 5, category: 'geography', title: 'Largest lake', text: 'Mjøsa, north of Oslo, is the largest lake in Norway.', placeIds: ['mjosa'] },
  { id: 6, category: 'geography', title: 'Mainland Europe\'s largest glacier', text: 'Jostedalsbreen in Vestland is the largest glacier in mainland Europe.', placeIds: ['jostedalsbreen'] },
  { id: 7, category: 'geography', title: 'An Arctic archipelago', text: 'Svalbard, roughly halfway between mainland Norway and the North Pole, is part of Norway. Its largest settlement is Longyearbyen.', placeIds: ['svalbard', 'longyearbyen'] },
  { id: 8, category: 'history', title: 'Constitution Day', text: 'The Norwegian constitution was signed at Eidsvoll on 17 May 1814. Norwegians celebrate 17 May as their national day.', placeIds: ['eidsvoll'] },
  { id: 9, category: 'history', title: 'Independence in 1905', text: 'Norway dissolved its union with Sweden in 1905 and became a fully independent kingdom.', placeIds: [] },
  { id: 10, category: 'history', title: 'First to the South Pole', text: 'Roald Amundsen\'s expedition was the first to reach the South Pole, on 14 December 1911.', placeIds: [] },
  { id: 11, category: 'history', title: 'Two votes against the EU', text: 'Norwegian voters rejected membership in the European Community in 1972 and in the European Union in 1994.', placeIds: [] },
  { id: 12, category: 'history', title: 'The Peace Prize', text: 'The Nobel Peace Prize is awarded in Oslo, while the other Nobel Prizes are awarded in Stockholm.', placeIds: ['oslo'] },
  { id: 13, category: 'culture', title: 'Two written standards', text: 'Norwegian has two official written standards, Bokmål and Nynorsk.', placeIds: [] },
  { id: 14, category: 'culture', title: 'Sámi languages', text: 'Sámi languages have official status in Norway, and the Sámi Parliament (Sámediggi) meets in Karasjok.', placeIds: ['karasjok'] },
  { id: 15, category: 'culture', title: 'The Scream', text: 'Edvard Munch, who painted The Scream, was Norwegian. The National Museum and the Munch museum in Oslo both hold versions of it.', placeIds: ['oslo'] },
  { id: 16, category: 'culture', title: 'A Doll\'s House', text: 'Henrik Ibsen, often called the father of modern drama, wrote A Doll\'s House in 1879.', placeIds: [] },
  { id: 17, category: 'culture', title: 'Brown cheese', text: 'Brunost is a sweet, caramel-colored cheese made from whey, usually sliced thin with a cheese slicer.', placeIds: [] },
  { id: 18, category: 'culture', title: 'The right to roam', text: 'Allemannsretten gives everyone the right to walk, camp, and pick berries on uncultivated land, including private land, as long as they act responsibly.', placeIds: [] },
  { id: 19, category: 'nature', title: 'Midnight sun', text: 'North of the Arctic Circle the sun doesn\'t set for part of the summer. At Nordkapp it stays above the horizon from mid-May to late July.', placeIds: ['nordkapp'] },
  { id: 20, category: 'nature', title: 'Polar bears', text: 'Polar bears live on Svalbard, where people leaving the settlements are required to carry protection against them.', placeIds: ['svalbard'] },
  { id: 21, category: 'nature', title: 'Wild reindeer', text: 'Hardangervidda, a mountain plateau in southern Norway, has the largest herd of wild mountain reindeer in Europe.', placeIds: ['hardangervidda'] },
  { id: 22, category: 'nature', title: 'Muskoxen on Dovrefjell', text: 'A herd of muskoxen, reintroduced from Greenland in the mid-1900s, lives on the Dovrefjell plateau.', placeIds: ['dovrefjell'] },
  { id: 23, category: 'economy', title: 'Hydropower', text: 'Hydropower generates close to 90% of Norway\'s electricity.', placeIds: [] },
  { id: 24, category: 'economy', title: 'Electric cars', text: 'About nine out of ten new passenger cars sold in Norway in 2024 were fully electric.', placeIds: [] },
  { id: 25, category: 'economy', title: 'Oil fund', text: 'The Government Pension Fund Global, funded by petroleum revenue, is one of the largest sovereign wealth funds in the world.', placeIds: [] },
  { id: 26, category: 'economy', title: 'Farmed salmon', text: 'Norway is the world\'s largest producer of farmed Atlantic salmon.', placeIds: [] },
  { id: 27, category: 'economy', title: 'Ekofisk', text: 'The discovery of the Ekofisk field in the North Sea in 1969 started Norway\'s oil age.', placeIds: ['ekofisk'] },
  { id: 28, category: 'history', title: 'The Kon-Tiki expedition', text: 'In 1947, Thor Heyerdahl and five crewmates, four Norwegians and a Swede, sailed the balsa wood raft Kon-Tiki about 8,000 km from Peru to French Polynesia in 101 days.', placeIds: [] },
  { id: 29, category: 'history', title: 'Why Kon-Tiki sailed', text: 'Heyerdahl built Kon-Tiki from materials available in ancient South America to show that people from there could have reached Polynesia by raft.', placeIds: [] },
  { id: 30, category: 'culture', title: 'The raft in Oslo', text: 'The original Kon-Tiki raft is on display at the Kon-Tiki Museet on the Bygdøy peninsula in Oslo.', placeIds: ['kon-tiki-museet', 'oslo'] },
  { id: 31, category: 'culture', title: 'Kon-Tiki on screen', text: 'Heyerdahl\'s documentary about the voyage, Kon-Tiki, won an Academy Award. A Norwegian feature film about the expedition, released in 2012, was nominated for one.', placeIds: [] },
];

// Places that facts are about, ordered by ID. IDs are lowercase ASCII slugs
// of the name.
export const places = [
  { id: 'dovrefjell', name: 'Dovrefjell', type: 'mountain-area', description: 'Mountain range in central Norway, home to a herd of muskoxen.' },
  { id: 'eidsvoll', name: 'Eidsvoll', type: 'municipality', description: 'Municipality north of Oslo where the constitution was signed in 1814.' },
  { id: 'ekofisk', name: 'Ekofisk', type: 'oil-field', description: 'Oil field in the Norwegian sector of the North Sea.' },
  { id: 'galdhopiggen', name: 'Galdhøpiggen', type: 'mountain', description: 'Mountain in Jotunheimen and the highest peak in Norway.' },
  { id: 'hardangervidda', name: 'Hardangervidda', type: 'plateau', description: 'Mountain plateau in southern Norway, the largest in Europe.' },
  { id: 'jostedalsbreen', name: 'Jostedalsbreen', type: 'glacier', description: 'Glacier in Vestland, the largest in mainland Europe.' },
  { id: 'jotunheimen', name: 'Jotunheimen', type: 'mountain-area', description: 'Mountain area in southern Norway with the country\'s highest peaks.' },
  { id: 'karasjok', name: 'Karasjok', type: 'municipality', description: 'Municipality in Finnmark and seat of the Sámi Parliament.' },
  { id: 'kon-tiki-museet', name: 'Kon-Tiki Museet', type: 'museum', description: 'Museum on the Bygdøy peninsula in Oslo that displays the Kon-Tiki raft and other vessels from Thor Heyerdahl\'s expeditions.' },
  { id: 'longyearbyen', name: 'Longyearbyen', type: 'settlement', description: 'The largest settlement on Svalbard.' },
  { id: 'mjosa', name: 'Mjøsa', type: 'lake', description: 'Lake north of Oslo and the largest in Norway.' },
  { id: 'nordkapp', name: 'Nordkapp', type: 'cape', description: 'Cliff on the island of Magerøya in Finnmark, often called the northernmost point of Europe.' },
  { id: 'oslo', name: 'Oslo', type: 'city', description: 'Capital and largest city of Norway.' },
  { id: 'sognefjord', name: 'Sognefjord', type: 'fjord', description: 'Fjord in Vestland and the longest and deepest in Norway.' },
  { id: 'svalbard', name: 'Svalbard', type: 'archipelago', description: 'Arctic archipelago between mainland Norway and the North Pole.' },
];
