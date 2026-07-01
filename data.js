// ===== ARE YOU THE GOAT? — DATA POOLS =====
// Ratings are fictional flavor values for gameplay, not real stat claims.

const HEIGHT_POOL = [
  { name: "Muggsy Bogues", label: "5'3\"", rating: 15 },
  { name: "Isaiah Thomas", label: "5'9\"", rating: 25 },
  { name: "Kyrie Irving", label: "6'2\"", rating: 38 },
  { name: "Stephen Curry", label: "6'2\"", rating: 42 },
  { name: "Jayson Tatum", label: "6'8\"", rating: 58 },
  { name: "LeBron James", label: "6'9\"", rating: 68 },
  { name: "Kevin Durant", label: "6'10\"", rating: 78 },
  { name: "Giannis Antetokounmpo", label: "6'11\"", rating: 82 },
  { name: "Rudy Gobert", label: "7'1\"", rating: 90 },
  { name: "Victor Wembanyama", label: "7'4\"", rating: 99 },
];

const FRAME_POOL = [
  { name: "Stephen Curry", label: "Slight", rating: 30 },
  { name: "LeBron James", label: "Athletic", rating: 60 },
  { name: "Zion Williamson", label: "Bulky", rating: 80 },
  { name: "Shaquille O'Neal", label: "Powerful", rating: 99 },
];

const SKILL_POOLS = {
  Shooting: [
    { name: "Gheorghe Muresan", rating: 22 },
    { name: "Ben Simmons", rating: 30 },
    { name: "Rudy Gobert", rating: 38 },
    { name: "Russell Westbrook", rating: 55 },
    { name: "Anthony Edwards", rating: 78 },
    { name: "Kevin Durant", rating: 90 },
    { name: "Damian Lillard", rating: 92 },
    { name: "Klay Thompson", rating: 94 },
    { name: "Ray Allen", rating: 95 },
    { name: "Stephen Curry", rating: 99 },
  ],
  Finishing: [
    { name: "Chris Paul", rating: 55 },
    { name: "Trae Young", rating: 58 },
    { name: "Devin Booker", rating: 76 },
    { name: "Ja Morant", rating: 85 },
    { name: "Dwyane Wade", rating: 89 },
    { name: "Zion Williamson", rating: 90 },
    { name: "Giannis Antetokounmpo", rating: 92 },
    { name: "Shaquille O'Neal", rating: 95 },
    { name: "Kareem Abdul-Jabbar", rating: 96 },
    { name: "Wilt Chamberlain", rating: 99 },
  ],
  Playmaking: [
    { name: "Ben Simmons", rating: 65 },
    { name: "Russell Westbrook", rating: 78 },
    { name: "Luka Doncic", rating: 88 },
    { name: "LeBron James", rating: 90 },
    { name: "Chris Paul", rating: 92 },
    { name: "Jason Kidd", rating: 93 },
    { name: "Steve Nash", rating: 95 },
    { name: "Nikola Jokic", rating: 96 },
    { name: "John Stockton", rating: 98 },
    { name: "Magic Johnson", rating: 99 },
  ],
  Defense: [
    { name: "Trae Young", rating: 42 },
    { name: "Damian Lillard", rating: 55 },
    { name: "Devin Booker", rating: 62 },
    { name: "Jimmy Butler", rating: 80 },
    { name: "Draymond Green", rating: 88 },
    { name: "Kawhi Leonard", rating: 91 },
    { name: "Evan Mobley", rating: 93 },
    { name: "Rudy Gobert", rating: 95 },
    { name: "Bill Russell", rating: 97 },
    { name: "Victor Wembanyama", rating: 98 },
  ],
  Rebounding: [
    { name: "Stephen Curry", rating: 35 },
    { name: "Trae Young", rating: 40 },
    { name: "Kevin Durant", rating: 65 },
    { name: "LeBron James", rating: 75 },
    { name: "Giannis Antetokounmpo", rating: 85 },
    { name: "Domantas Sabonis", rating: 90 },
    { name: "Andre Drummond", rating: 92 },
    { name: "Wilt Chamberlain", rating: 97 },
    { name: "Dennis Rodman", rating: 98 },
    { name: "Bill Russell", rating: 99 },
  ],
};

// Cheap fallback pool used when remaining budget can't afford anything above
const BUDGET_BIN = [
  { name: "Solid Role Player", rating: 42 },
  { name: "Reliable Bench Vet", rating: 47 },
  { name: "Rotation Piece", rating: 51 },
  { name: "Hustle Guy", rating: 55 },
];

const TEAMS = [
  { abbr: "BOS", name: "Boston Celtics", scr: 88 },
  { abbr: "OKC", name: "Oklahoma City Thunder", scr: 87 },
  { abbr: "DEN", name: "Denver Nuggets", scr: 84 },
  { abbr: "NYK", name: "New York Knicks", scr: 90 },
  { abbr: "MIN", name: "Minnesota Timberwolves", scr: 78 },
  { abbr: "MIL", name: "Milwaukee Bucks", scr: 76 },
  { abbr: "CLE", name: "Cleveland Cavaliers", scr: 80 },
  { abbr: "HOU", name: "Houston Rockets", scr: 79 },
  { abbr: "DAL", name: "Dallas Mavericks", scr: 77 },
  { abbr: "LAL", name: "Los Angeles Lakers", scr: 75 },
  { abbr: "GSW", name: "Golden State Warriors", scr: 73 },
  { abbr: "LAC", name: "LA Clippers", scr: 72 },
  { abbr: "MEM", name: "Memphis Grizzlies", scr: 71 },
  { abbr: "IND", name: "Indiana Pacers", scr: 74 },
  { abbr: "ORL", name: "Orlando Magic", scr: 70 },
  { abbr: "PHI", name: "Philadelphia 76ers", scr: 68 },
  { abbr: "PHX", name: "Phoenix Suns", scr: 66 },
  { abbr: "MIA", name: "Miami Heat", scr: 65 },
  { abbr: "SAC", name: "Sacramento Kings", scr: 62 },
  { abbr: "NOP", name: "New Orleans Pelicans", scr: 60 },
  { abbr: "SAS", name: "San Antonio Spurs", scr: 58 },
  { abbr: "ATL", name: "Atlanta Hawks", scr: 55 },
  { abbr: "CHI", name: "Chicago Bulls", scr: 50 },
  { abbr: "DET", name: "Detroit Pistons", scr: 45 },
  { abbr: "TOR", name: "Toronto Raptors", scr: 48 },
  { abbr: "BKN", name: "Brooklyn Nets", scr: 42 },
  { abbr: "POR", name: "Portland Trail Blazers", scr: 40 },
  { abbr: "UTA", name: "Utah Jazz", scr: 35 },
  { abbr: "CHA", name: "Charlotte Hornets", scr: 30 },
  { abbr: "WAS", name: "Washington Wizards", scr: 25 },
];

const POSITIONS = {
  PG: { label: "Point Guard", hMin: 15, hMax: 50 },
  SG: { label: "Shooting Guard", hMin: 35, hMax: 65 },
  SF: { label: "Small Forward", hMin: 50, hMax: 80 },
  PF: { label: "Power Forward", hMin: 65, hMax: 90 },
  C: { label: "Center", hMin: 80, hMax: 99, frameMin: 70 },
};

if (typeof module !== "undefined") {
  module.exports = { HEIGHT_POOL, FRAME_POOL, SKILL_POOLS, BUDGET_BIN, TEAMS, POSITIONS };
}
