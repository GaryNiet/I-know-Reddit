// Subreddit autocomplete. Devvit's public Reddit client has no subreddit
// search, so suggestions come from this bundled list plus the subreddits the
// app has seen in r/popular (stored in Redis), and the server separately
// checks whether the exact name typed exists. No imports so tests run in Node.

/** Large, mostly image-friendly, SFW communities. Order is a rough popularity hint. */
export const KNOWN_SUBREDDITS = [
  'pics', 'funny', 'memes', 'aww', 'mildlyinteresting', 'interestingasfuck', 'Damnthatsinteresting',
  'BeAmazed', 'oddlysatisfying', 'nextfuckinglevel', 'gaming', 'movies', 'television', 'Music',
  'todayilearned', 'science', 'space', 'EarthPorn', 'pcmasterrace', 'wholesomememes', 'me_irl',
  'meirl', 'dankmemes', 'AdviceAnimals', 'mildlyinfuriating', 'facepalm', 'therewasanattempt',
  'WhitePeopleTwitter', 'BlackPeopleTwitter', 'clevercomebacks', 'MadeMeSmile', 'HumansBeingBros',
  'CrappyDesign', 'assholedesign', 'Wellthatsucks', 'WTF', 'Unexpected', 'PeopleFuckingDying',
  'AnimalsBeingDerps', 'AnimalsBeingBros', 'AnimalsBeingJerks', 'NatureIsFuckingLit', 'cats',
  'dogs', 'Eyebleach', 'rarepuppers', 'catpictures', 'StartledCats', 'blackcats', 'corgi',
  'whatsthisbug', 'whatisthisthing', 'food', 'FoodPorn', 'Cooking', 'Baking', 'pizza',
  'shittyfoodporn', 'castiron', 'gardening', 'houseplants', 'DIY', 'woodworking', 'somethingimade',
  'crafts', 'knitting', 'Art', 'drawing', 'painting', 'photography', 'itookapicture',
  'OldSchoolCool', 'TheWayWeWere', 'HistoryPorn', 'history', 'MapPorn', 'dataisbeautiful',
  'Infographics', 'europe', 'unitedkingdom', 'canada', 'australia', 'newzealand', 'ireland',
  'india', 'germany', 'de', 'france', 'japan', 'japanpics', 'CityPorn', 'ArchitecturePorn',
  'InteriorDesign', 'malelivingspace', 'RoomPorn', 'battlestations', 'buildapc', 'techsupportgore',
  'ProgrammerHumor', 'technology', 'gadgets', 'Android', 'apple', 'iphone', 'linux',
  'linuxmemes', 'sysadmin', 'programming', 'Minecraft', 'leagueoflegends', 'pokemon',
  'PokemonGoMemes', 'nintendo', 'NintendoSwitch', 'PS5', 'xbox', 'Steam', 'pcgaming', 'Games',
  'gamingmemes', 'GamePhysics', 'skyrim', 'eldenring', 'fo4', 'Fallout', 'zelda', 'StardewValley',
  'thesims', 'DnD', 'boardgames', 'lego', 'starwars', 'PrequelMemes', 'lotrmemes', 'marvelstudios',
  'Marvel', 'DC_Cinematic', 'batman', 'StarWarsMemes', 'freefolk', 'HouseOfTheDragon',
  'TheSimpsons', 'TheOffice', 'thesopranos', 'breakingbad', 'BetterCallSaul', 'anime',
  'Animemes', 'manga', 'OnePiece', 'Naruto', 'comics', 'webcomics', 'comicbooks', 'xkcd',
  'sports', 'nba', 'nfl', 'soccer', 'baseball', 'hockey', 'formula1', 'MMA', 'tennis', 'golf',
  'cycling', 'running', 'fitness', 'bodybuilding', 'climbing', 'skiing', 'surfing', 'hiking',
  'CampingandHiking', 'camping', 'NationalPark', 'travel', 'cars', 'carporn', 'Shitty_Car_Mods',
  'IdiotsInCars', 'Justrolledintotheshop', 'motorcycles', 'bicycling', 'trains', 'aviation',
  'Planes', 'boats', 'MostBeautiful', 'Outdoors', 'SkyPorn', 'spaceporn', 'astrophotography',
  'nasa', 'Astronomy', 'geology', 'mycology', 'birding', 'Birbs', 'parrots', 'reptiles',
  'snakes', 'aquariums', 'Awwducational', 'bestof', 'LifeProTips', 'YouShouldKnow', 'coolguides',
  'CozyPlaces', 'BuyItForLife', 'antiques', 'ThriftStoreHauls', 'Watches', 'malefashionadvice',
  'femalefashionadvice', 'sneakers', 'tattoos', 'Beardporn', 'OldPhotosInRealLife',
  'ColorizedHistory', 'PropagandaPosters', 'Military', 'WarplanePorn', 'tanks', 'urbanexploration',
  'AbandonedPorn', 'LiminalSpace', 'Showerthoughts', 'NoStupidQuestions',
  'AskReddit', 'explainlikeimfive', 'books', 'BookPorn', 'writing', 'poetry', 'tumblr',
  'TikTokCringe', 'BikiniBottomTwitter', 'Funnymemes', 'ComedyCemetery', 'terriblefacebookmemes',
  'boomershumor', 'insanepeoplefacebook', 'trippinthroughtime', 'HistoryMemes', 'SequelMemes',
  'shitposting', 'surrealmemes', 'MemeEconomy', 'teenagers', 'CasualUK',
  'britishproblems', 'AmItheAsshole', 'pettyrevenge', 'ChoosingBeggars', 'CrazyIdeas',
  'confidentlyincorrect', 'NotHowGirlsWork', 'technicallythetruth', 'rareinsults',
  'MurderedByWords', 'BrandNewSentence', 'ATBGE', 'DiWHY', 'redneckengineering', 'specializedtools',
  'ThatsInsane', 'hmmm', 'Pareidolia', 'evilbuildings', 'CatsStandingUp',
  'SupermodelCats', 'IllegallySmolCats', 'Catswithjobs', 'tippytaps', 'dogpictures', 'goldenretrievers',
  'germanshepherds', 'Pitbulls', 'Rabbits', 'hamsters', 'Otters', 'redpandas', 'foxes', 'Sneks',
] as const;

export type SuggestionInput = {
  query: string;
  known: readonly string[];
  /** name -> how often it appeared in r/popular (higher is better) */
  seen: ReadonlyMap<string, number>;
  exclude?: ReadonlySet<string> | undefined; // lowercased
  limit?: number;
};

export type RankedSuggestion = { name: string; source: 'popular' | 'list' };

/**
 * Prefix matches rank above substring matches; within each, subreddits seen
 * often in r/popular come first, then the bundled list's order.
 */
export function rankSuggestions(input: SuggestionInput): RankedSuggestion[] {
  const q = input.query.trim().replace(/^\/?r\//i, '').toLowerCase();
  const limit = input.limit ?? 8;
  const byLower = new Map<string, { name: string; source: 'popular' | 'list'; seen: number; order: number }>();

  input.known.forEach((name, order) => {
    byLower.set(name.toLowerCase(), { name, source: 'list', seen: 0, order });
  });
  for (const [name, count] of input.seen) {
    const key = name.toLowerCase();
    const prev = byLower.get(key);
    byLower.set(key, {
      name: prev?.name ?? name,
      source: 'popular',
      seen: count,
      order: prev?.order ?? Number.MAX_SAFE_INTEGER,
    });
  }

  const scored: { s: RankedSuggestion; rank: number[] }[] = [];
  for (const [lower, v] of byLower) {
    if (input.exclude?.has(lower)) continue;
    let matchRank: number;
    if (!q) matchRank = 0;
    else if (lower === q) matchRank = -1;
    else if (lower.startsWith(q)) matchRank = 0;
    else if (lower.includes(q)) matchRank = 1;
    else continue;
    scored.push({ s: { name: v.name, source: v.source }, rank: [matchRank, -v.seen, v.order, lower.length] });
  }
  scored.sort((a, b) => {
    for (let i = 0; i < a.rank.length; i++) {
      const d = (a.rank[i] ?? 0) - (b.rank[i] ?? 0);
      if (d) return d;
    }
    return 0;
  });
  return scored.slice(0, limit).map((x) => x.s);
}
