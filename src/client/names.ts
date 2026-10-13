import { getLang } from './i18n.ts';

const KO_A = ['말랑', '쫀득', '반짝', '통통', '몽글', '촉촉', '말캉', '퐁당', '새콤', '달콤', '용감한', '졸린', '날쌘', '엉뚱한', '느긋한', '씩씩한', '수줍은', '장난꾸러기', '꼬물', '뭉게'];
const KO_B = ['젤리', '푸딩', '방울', '구름', '모찌', '버블', '슬라임', '콩이', '두부', '찹쌀', '별똥', '물방울', '솜사탕', '꿀떡', '도토리', '젤리빈', '마시멜로', '핫도그', '호빵', '단지'];
const EN_A = ['Jelly', 'Bubbly', 'Squishy', 'Wobbly', 'Sparkly', 'Sleepy', 'Brave', 'Mellow', 'Gooey', 'Plump', 'Zesty', 'Fuzzy', 'Dizzy', 'Shiny', 'Tiny', 'Lucky'];
const EN_B = ['Blob', 'Pudding', 'Mochi', 'Drop', 'Bean', 'Muffin', 'Pebble', 'Cloud', 'Gumdrop', 'Noodle', 'Biscuit', 'Splash', 'Marble', 'Dumpling', 'Pip', 'Goo'];

const pick = <T>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)]!;

/** A cheerful random slime name in the current language (always within the 36-character name limit). */
export function randomName(): string {
  return getLang() === 'ko' ? `${pick(KO_A)}${pick(KO_B)}` : `${pick(EN_A)} ${pick(EN_B)}`;
}
