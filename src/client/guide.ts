import { h } from './dom.ts';
import { type Lang, getLang } from './i18n.ts';
import { settings } from './settings.ts';

interface Block {
  h: string;
  p?: string[];
  rows?: [string, string][];
  after?: string[];
}

const KO: Block[] = [
  { h: '글자 수 제한', p: ['사용자명은 32자까지, 슬라임 이름은 36자까지입니다.'] },
  {
    h: '게임의 흐름',
    p: [
      '① 타이틀 화면에서 「사용자명」과 「비밀번호」를 입력하고 입장을 누릅니다. 비밀번호를 잊으면 이어서 플레이할 수 없으니 꼭 기억해 두세요.',
      '② 내 슬라임이 표시됩니다. 마음에 드는 교배 상대를 골라 「교배」를 누르세요. 씨가 없는 슬라임은 고를 수 없습니다.',
      '③ 새로 태어난 슬라임이 표시됩니다. 이름을 붙여 주세요. 「이름은 아직 없음」은 너무 불쌍하니까요.',
      '④ 「전투 개시」를 누르면 전투 결과가 표시됩니다. 전투는 모두 자동으로 진행되며, 지시도 도움도 줄 수 없습니다. 랭킹 하위부터 포인트에 따라 질 때까지 차례로 싸웁니다.',
      '⑤ 이겼다면 아래 프레임의 「랭킹」을 눌러 몇 위가 되었는지 확인하세요. 졌다면 다시 도전하세요{wait}.',
    ],
    after: [
      '・{cd}분에 한 번만 플레이할 수 있습니다.',
      '・7일 동안 플레이하지 않은 계정은 삭제됩니다(랭킹에 있는 슬라임은 남습니다).',
      '・슬라임은 한 번 교배할 때마다 1세대 진행되며, 유저는 자손에게 계속 교배시키는 것만 할 수 있습니다. 한 번 싸운 슬라임은 더 이상 손댈 수 없습니다.',
      '・같은 사용자명으로는 슬라임을 한 마리만 다룰 수 있습니다.',
    ],
  },
  {
    h: '플레이 방법',
    p: [
      '여러분이 할 수 있는 일은 슬라임의 교배 상대를 고르는 것뿐입니다. 그래서 조작은 아주 단순합니다. 처음에는 적당히 골라도 좋습니다. 그러다 보면 점점 요령을 알게 될 거예요.',
      '정보를 읽을 수 있게 되면 한층 깊어집니다. 하지만 정보를 읽는다고 해서 반드시 강한 슬라임이 만들어지는 것은 아닙니다. 정보를 읽는 것 자체를 즐겨 주세요.',
    ],
  },
  {
    h: '능력치 설명',
    rows: [
      ['HP', '히트 포인트. 공격을 받아 0 이하가 되면 패배합니다.'],
      ['STM', '스태미나. 행동할 때마다 줄어들고, 줄어들수록 점점 약해집니다. 50% 아래로 내려가면 급격히 약해지고, 0이 되면 본래 힘의 절반 정도밖에 내지 못합니다.'],
      ['STR', '스트렝스. 완력. 한 번의 공격으로 주는 피해의 크기입니다.'],
      ['DEX', '덱스터리티. 손재주. 공격이 얼마나 잘 맞는지입니다.'],
      ['AGL', '애질리티. 민첩함. 상대의 공격을 피하는 능력입니다.'],
      ['SPD', '스피드. 높을수록 공격이 빨라 더 많이 공격할 수 있습니다.'],
    ],
    after: [
      '체중(weight)이 무거운 개체는 HP와 STR이 높고, 가벼운 개체는 DEX・AGL・SPD가 높습니다. 덩치가 크면 완력이 세고, 작으면 빠르다는 뜻입니다.',
      '종 전체가 강해져 능력치의 자릿수가 늘어나면 10으로 나누어 자릿수를 줄여서 표시합니다. 보기 쉽게 하려는 것일 뿐 실제 능력치가 줄어든 것은 아닙니다.',
    ],
  },
  {
    h: '혈통(계보)',
    p: [
      '경마 게임을 아신다면 아실 혈통표입니다. 위 줄은 모체(내 쪽), 아래 줄은 씨(상대 쪽)이며, 왼쪽부터 부모・조부모・증조부・계통 순서입니다. 이하 설명에서는 직계 부모를 「모」, 씨의 부모를 「부」라고 부릅니다.',
      '이름을 클릭하면 아직 랭킹에 있는 경우 그 슬라임이 표시됩니다. 이름 오른쪽의 숫자는 세대이며, 씨는 흰색, 모체는 분홍색입니다. 증조모는 표시를 생략했습니다.',
      '계통은 아버지의 계통을 이어받습니다. 노란색이 아버지 계통이며, 이 계통으로 태어난 슬라임은 같은 계통이 됩니다. 주황색은 모부(어머니의 아버지)의 계통입니다. 노란색 계통명을 클릭하면 그 계통의 슬라임을 표시합니다. 자식을 찾을 때 편리합니다.',
    ],
  },
  {
    h: '혈통의 궁합(닉스)',
    p: [
      '계통에는 6개 능력치에 대한 궁합이 정해져 있으며 「○×◎△××」처럼 표시됩니다. 왼쪽부터 HP・STM・STR・DEX・AGL・SPD에 대응합니다.',
      '교배 상대를 고르는 화면 아래의 「혈통 궁합 목록」에서 내 슬라임과 다른 계통의 궁합을 대략 알 수 있습니다. 태어난 슬라임의 4개 계통이 모두 다르게 배합하면 닉스 효과를 최대로 끌어낼 수 있고, 3종류뿐이면 한 단계 떨어지며, 2종류 이하면 닉스 효과가 거의 없고 약간의 폐해도 따릅니다.',
      '닉스 효과에 의한 능력치 상승률: △=5%, ○=10%, ◎=15%, ☆=20%, ★=25%, ♪=30%, ∞=35%. 「혈통 궁합 목록」을 참고해 4종 계통이 갖춰지도록 교배하는 것이 효과적입니다.',
    ],
  },
  {
    h: '계통 타입',
    p: [
      '계통에는 타입이 있으며 HP・STM 등 6개 능력치 중 하나가 배정됩니다. 그 타입의 능력치가 오르기 쉬워집니다. 모 4계통+부 4계통, 합계 8개 계통 중 5종류 이상이 갖춰지면 모와 부의 계통 타입 능력이 더욱 강화됩니다. 종류가 많을수록 효과도 커집니다. 혈통 궁합 목록에서 (STR) 등으로 적힌 것이 계통 타입입니다.',
    ],
  },
  {
    h: '새 계통',
    p: [
      '새 계통을 만드는 방법은 두 가지입니다.',
      '1. 「미지의 씨앗」과 교배하면 새 계통이 만들어집니다. 계통 이름은 태어난 슬라임에게 붙인 이름이 됩니다.',
      '2. 무패로 1위가 된 경우에도 새 계통이 만들어집니다. 계통 이름은 그 슬라임의 이름이 되고, 원래 계통은 계통 일람의 계보에 기록됩니다.',
    ],
  },
  {
    h: '전투 결과 리포트',
    p: [
      'HP: 남은 HP. 분모는 HP의 최댓값입니다.',
      'STM: 전투 종료 시 남은 스태미나. 어디쯤에서 스태미나가 떨어졌는지 짐작할 수 있습니다.',
      '명중 / 공격: 공격 횟수와 그중 명중한 횟수입니다.',
      '평균 피해: 상대에게 준 피해의 평균입니다.',
      'LUCK: 행운도. 나온 난수의 평균값입니다. 클수록 운이 좋았다는 뜻입니다. 첫 번째 숫자는 명중 판정으로 0~100이며 기댓값은 50, 괄호 안은 피해량 판정으로 0~200이며 기댓값은 약 80입니다.',
      '전투 로그: 왼쪽 끝이 전투의 시작이며 오른쪽으로 흘러갑니다. 큰 글자 C・O・X는 내 공격이고, O는 명중, X는 빗나감, C는 크리티컬 히트입니다. 작은 글자 c・o・x는 상대의 공격입니다. 크리티컬은 보통의 약 2배 이상의 피해를 주며, 확률은 1% 정도입니다.',
    ],
  },
  {
    h: '랭킹의 구조',
    p: [
      '랭킹은 포인트제입니다. 랭킹에 든 각 개체는 포인트를 가지고 있으며, 쓰러뜨리면 그 포인트를 얻습니다. 져도 포인트가 줄지는 않습니다.',
      '막 태어난 슬라임은 1포인트를 가지고 있고, 랭킹 하위부터 자신 이상의 포인트를 가진 상대와 질 때까지 싸웁니다(3위 이상은 포인트와 관계없이 반드시 싸웁니다). 도전자의 연승을 막은 상대 슬라임에게는 그때까지 도전자가 모은 포인트가 통째로 들어갑니다. 싸움이 끝나면 포인트 순으로 재정렬되어 순위가 정해집니다. 하위 슬라임의 포인트가 세 자리에 이르면 가끔 랭킹 전체를 10의 거듭제곱으로 나누어 자릿수를 떨어뜨립니다.',
      '단, 1위는 특별 취급입니다. 재정렬 결과 1위보다 많은 포인트를 가진 개체가 있으면 1위 방어전이 열립니다. 방어전에 이긴 1위 슬라임은 이름 옆에 방어 횟수가 별로 표시됩니다.',
    ],
  },
  {
    h: '전당',
    p: [
      '1위를 4회 이상 방어한 슬라임은 전설의 슬라임으로 전당에 오릅니다. 그 이름은 후세에 길이 전해질 것입니다. 전당 등록은 방어에 실패했을 때 이루어지며, 등록되는 데이터도 그 시점의 것입니다.',
      '전당에 오른 슬라임은 그 계통이 랭킹에 없을 때 교배 상대로 고를 수 있습니다(씨는 줄지 않습니다). 전당에 오르면 계통의 부활이 가능해져 그 계통이 완전히 멸망하는 일은 없습니다.',
    ],
  },
  {
    h: '유전자에 대해',
    p: [
      '이 게임에 등장하는 슬라임은 모두 유전자를 가지고 있으며, 능력치와 신체적 특징은 전부 유전자로 결정됩니다. 유전되는 것은 근육・두뇌・신경 같은 신체적 특징이고, STR 같은 능력치는 그것들이 복잡하게 얽혀 결정됩니다.',
      '각 부모에게서 절반씩 유전자를 물려받으므로 각 파라미터에는 두 개의 유전자가 있습니다. 둘 중 「자기주장」이 더 강한 쪽이 능력치에 영향을 주고, 나머지 하나는 겉으로 드러나지 않습니다. 드러나지 않은 유전자는 다음 세대에서 나타날 수도 있습니다. 이렇게 격세유전을 시뮬레이션합니다. 인브리드는 「그 조상의 유전자를 가질 확률을 높이는 수단」이라는 것이 만든 사람의 해석입니다.',
      '유전자는 10개의 신체 유전자와 색・변이를 정하는 9개의 스위치로 이루어져 있습니다. 어떤 스위치 조건이 모두 갖춰지면 변이체가 나타납니다. 오라・날개・리본・왕관・천사・악마・벌레・아호・좀비・아저씨… 몇 종류가 숨어 있습니다. 만날 수 있을까요? (변이는 외형만 바뀝니다.)',
    ],
  },
  {
    h: '진화에 대해',
    p: [
      '강해질지 약해질지는 난수상으로 같은 확률이 되도록 프로그램되어 있습니다. 하지만 랭킹에 들 수 있는 개체가 한정되어 있고, 모두가 더 능력이 높은 개체를 교배 상대로 고를 테니 거기에는 도태압이 걸립니다. 약한 개체는 자손을 남길 기회가 줄어드는 것이죠. 따라서 강약의 변화가 난수상 같은 확률이어도 종으로서 진화해 갈 것입니다. 그것을 시뮬레이션해 보고 싶었습니다. 슬라임들이 어떻게 진화해 갈지 다 같이 지켜봅시다.',
    ],
  },
  {
    h: '이야기',
    p: [
      '신은 심심해서 점토로 슬라임을 만들었습니다. 하나는 아무것도 가지지 못한 검은 슬라임 아담, 다른 하나는 많은 것을 가진 하얀 슬라임 이브였습니다. 아담은 씨를 만들었고 이브는 그 씨를 먹었습니다. 이브의 몸은 여러 모로 변했고 회색 슬라임이 되었습니다. 아담의 씨를 먹은 이브는 모두 회색이 되었습니다. 곧 슬라임이 많이 늘어났고, 어느 날 먹이가 떨어졌습니다. 그리하여 싸움이 시작되었습니다.',
    ],
  },
  {
    h: '크레딧',
    p: [
      'SLIME BREEDER (1999) 및 SLIME BREEDER plus v1.08 — 원작 tatuta. 영어판 번역 rika. 이 사이트는 원작자의 허락 조건(개조 재배포 허용, 비상업)에 따라 만든 개조판 “Reborn”입니다. 자세한 내용은 NOTICE.md를 참조하세요.',
    ],
  },
];

const EN: Block[] = [
  { h: 'Limits', p: ['Usernames can be up to 32 characters, slime names up to 36.'] },
  {
    h: 'How a play goes',
    p: [
      '1. On the title screen enter a username and password and press Enter. If you forget the password you cannot continue, so remember it.',
      '2. Your slime is shown. Pick a mate and press Mate! Slimes with no seeds left cannot be chosen.',
      '3. The newborn is shown. Give it a name.',
      '4. Press Fight! The battle is fully automatic. It fights up from the bottom of the ranking, against slimes with at least its points, until it loses.',
      '5. If it did well, open the Ranking in the lower frame to see where it ended up. If it lost, try again{wait}.',
    ],
    after: [
      '· You can play once per {cd} minutes.',
      '· Accounts idle for 7 days are deleted (ranked slimes stay).',
      '· Each mating advances one generation; you can only keep mating with your descendants. A slime that has fought cannot be touched again.',
      '· One slime per username.',
    ],
  },
  {
    h: 'Parameters',
    rows: [
      ['HP', 'Hit points. At zero the slime loses.'],
      ['STM', 'Stamina. It drains with every action and the slime weakens as it does: fast below 50%, to about half strength at zero.'],
      ['STR', 'Strength: damage per hit.'],
      ['DEX', 'Dexterity: how easily attacks land.'],
      ['AGL', 'Agility: how well attacks are evaded.'],
      ['SPD', 'Speed: the faster slime attacks more often.'],
    ],
    after: [
      'Heavy slimes have more HP and STR; light slimes have higher DEX, AGL and SPD. When the species grows strong, numbers are shown divided by 10, 100… (the real values are unchanged).',
    ],
  },
  {
    h: 'Pedigree and lineages',
    p: [
      'Row 1 is your slime’s side, row 2 the mate’s. Columns: parent | grandparents | great-grandfathers | bloodlines. Cyan names have left the ranking; blue names are links. The number is the generation (white for the seed side, pink for the mother side).',
      'A child belongs to its father’s lineage (yellow). Orange is the mother’s father’s lineage. Click a lineage to list its slimes.',
      'Each lineage has an affinity with the six stats, shown like “○×◎△××” (HP, STM, STR, DEX, AGL, SPD). Mate so that the four lineages of the child are all different to get the full “nicks” boost (△ 5%, ○ 10%, ◎ 15%, ☆ 20%, ★ 25%, ♪ 30%, ∞ 35%); with three kinds it is a notch lower, with two or fewer there is little effect and a penalty.',
      'Each lineage also has a type (one stat). With 5 or more different lineages among the eight of both parents, the types of mother and father are boosted more.',
      'A new lineage is born (1) when you mate with an unknown seed (named after the newborn) and (2) when a slime reaches rank 1 unbeaten (named after it; the old lineage stays in the genealogy).',
    ],
  },
  {
    h: 'Battle report',
    p: [
      'HP: remaining / maximum. STM: stamina left. Hits / attacks, and the average damage.',
      'LUCK: average of the random rolls. First number: hit roll (0-100, expected 50). In parentheses: damage roll (0-200, expected about 80).',
      'Log: big C O X are your hits; O hit, X miss, C critical. Small c o x are the opponent’s. A critical does about double damage and happens roughly 1% of the time.',
    ],
  },
  {
    h: 'Ranking, Hall of Fame',
    p: [
      'Points rule the ranking. A newborn has 1 point and fights upward from the bottom, only against slimes with at least its points (the top three always), until it loses. Beating a slime takes over all its points; losing costs nothing, but the slime that ends a run collects every point the challenger had. Totals are divided when the lowest rank reaches three digits.',
      'The top slime is special: if someone out-scores it, a title defense match is held. A champion that defended 4 or more times enters the Hall of Fame when dethroned. Legends whose lineage has left the ranking can be chosen as mates without spending seeds, reviving the lineage.',
    ],
  },
  {
    h: 'Genes and evolution',
    p: [
      'Every slime has two strands of 19 genes: ten body genes (the more assertive of each pair is expressed; the other can resurface later) and nine switches for colour and mutants. When the right switches line up a mutant appears (aura, wings, ribbon, crown, angel, devil, insect, aho, zombie, oyaji…). Mutants are cosmetic.',
      'Strong or weak is a coin flip at birth, but strong slimes are picked as mates more often, so the species evolves.',
    ],
  },
  {
    h: 'Credits',
    p: ['SLIME BREEDER (1999) and SLIME BREEDER plus v1.08 by tatuta; English edition by rika. This is the modified version “Reborn”, made under the author’s redistribution terms (non-commercial). See NOTICE.md.'],
  },
];

const GUIDES: Record<Lang, Block[]> = { ko: KO, en: EN };

/** Fill in the server's play interval; with no waiting at all the sentences about it are dropped. */
const fill = (lines: string[] | undefined) => {
  const cd = settings.cooldownMin;
  const wait = cd > 0 ? (getLang() === 'ko' ? ` (${cd}분 뒤부터 가능)` : ` in ${cd} minutes`) : '';
  return (lines ?? []).filter((l) => cd > 0 || !/^[・·] ?\{cd\}/.test(l)).map((l) => l.replace(/\{cd\}/g, String(cd)).replace('{wait}', wait));
};

export function guideView(): HTMLElement {
  const root = h('div', { class: 'guide' }, h('h2', { class: 'section-title gold' }, getLang() === 'ko' ? '설명서' : 'Instructions'));
  for (const b of GUIDES[getLang()]) {
    root.append(h('h3', { class: 'shine-cyan' }, `★ ${b.h}`));
    for (const para of fill(b.p)) root.append(h('p', {}, para));
    if (b.rows) root.append(h('table', {}, ...b.rows.map(([a, c]) => h('tr', {}, h('td', { class: 'statname' }, a), h('td', {}, c)))));
    for (const para of fill(b.after)) root.append(h('p', {}, para));
  }
  return root;
}
