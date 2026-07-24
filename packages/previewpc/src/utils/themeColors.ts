const themeColors = {
    /* brand */
  "--brand-05": "#E6F2FD",
  "--brand-10": "#B8D9F9",
  "--brand-20": "#8ABEF3",
  "--brand-30": "#5CA2E9",
  "--brand-40": "#2E86DE",
  "--brand-50": "#0067D1",
  "--brand-60": "#004EA8",
  "--brand-70": "#003D83",
  "--brand-80": "#002E6A",
  "--brand-90": "#00214B",

  /* gray */
   "--gray-0": "#FFFFFF",
   "--gray-05": "#F3F3F3",
   "--gray-10": "#DFDFDF",
   "--gray-20": "#C9C9C9", 
   "--gray-30": "#AEAEAE",
   "--gray-40": "#939393",
   "--gray-50": "#777777",
   "--gray-60": "#595959",
   "--gray-70": "#393939",
   "--gray-80": "#2A2A2A",
   "--gray-90": "#191919",
   "--gray-100": "#000000",

   /* red */
   "--red-05": "#FEE7E8",
   "--red-10": "#FABDC1",
   "--red-20": "#F59297",
   "--red-30": "#EE696F",
   "--red-40": "#E7434A",
   "--red-50": "#E02128",
   "--red-60": "#C7000B",
   "--red-70": "#850F12",
   "--red-80": "#59080A",
   "--red-90": "#350305",

   /* rose */
   "--rose-05": "#FEE5F2",
   "--rose-10": "#FCC3E0",
   "--rose-20": "#F99AC7",
   "--rose-30": "#F470AB",
   "--rose-40": "#ED448A",
   "--rose-50": "#E61866",
   "--rose-60": "#C40054",
   "--rose-70": "#811439",
   "--rose-80": "#540D24",
   "--rose-90": "#330614",

   /* orange */
   "--orange-05": "#FEF5E8",
   "--orange-10": "#FDE2BD",
   "--orange-20": "#FCCE92",
   "--orange-30": "#F9B766",
   "--orange-40": "#F69E39",
   "--orange-50": "#F4840C",
   "--orange-60": "#C76207",
   "--orange-70": "#954304",
   "--orange-80": "#642802",
   "--orange-90": "#3D1601",

   /* yellow */
   "--yellow-05": "#FEFCE0",
   "--yellow-10": "#FEF8B8",
   "--yellow-20": "#FEF08A",
   "--yellow-30": "#FDE55C",
   "--yellow-40": "#FCD72E",
   "--yellow-50": "#FCC800",
   "--yellow-60": "#D19F00",
   "--yellow-70": "#9E7400",
   "--yellow-80": "#614500",
   "--yellow-90": "#2E1F00",

   /* green */
   "--green-05": "#F2FBE9",
   "--green-10": "#DFF4CC",
   "--green-20": "#C6E9A8",
   "--green-30": "#A8DB81",
   "--green-40": "#87C859",
   "--green-50": "#62B42E",
   "--green-60": "#488E20",
   "--green-70": "#316614",
   "--green-80": "#1B3E0A",
   "--green-90": "#0C2004",

   /* mint */
   "--mint-05": "#E7FBF2",
   "--mint-10": "#BCF2DB",
   "--mint-20": "#8FE5C2",
   "--mint-30": "#63D5A8",
   "--mint-40": "#36C18D",
   "--mint-50": "#09AA71",
   "--mint-60": "#058358",
   "--mint-70": "#036142",
   "--mint-80": "#02422E",
   "--mint-90": "#00291D",

   /* cyan */
   "--cyan-05": "#E8FCFD",
   "--cyan-10": "#C9F6F9",
   "--cyan-20": "#A4ECF1",
   "--cyan-30": "#7DDFE7",
   "--cyan-40": "#55CCD9",
   "--cyan-50": "#2CB8C9",
   "--cyan-60": "#1C94A4",
   "--cyan-70": "#127180",
   "--cyan-80": "#094C57",
   "--cyan-90": "#04282F",

   /* blue */
   "--blue-05": "#EEF3FE",
   "--blue-10": "#D0D8FD",
   "--blue-20": "#B0BFFD",
   "--blue-30": "#8CA3FA",
   "--blue-40": "#668CF7",
   "--blue-50": "#2070F3",
   "--blue-60": "#1F55B5",
   "--blue-70": "#1B3F86",
   "--blue-80": "#112857",
   "--blue-90": "#081635",

   /* indigo */
   "--indigo-05": "#EEEEFE",
   "--indigo-10": "#D5D3FD",
   "--indigo-20": "#BFB9FA",
   "--indigo-30": "#A89FF9",
   "--indigo-40": "#8E81F4",
   "--indigo-50": "#715AFB",
   "--indigo-60": "#5531EB",
   "--indigo-70": "#3F21B5",
   "--indigo-80": "#281675",
   "--indigo-90": "#160B48",

   /* purple */
   "--purple-05": "#F7EDFE",
   "--purple-10": "#E8CFFE",
   "--purple-20": "#D9B1FD",
   "--purple-30": "#CB8EFB",
   "--purple-40": "#BF68FA",
   "--purple-50": "#B62BF7",
   "--purple-60": "#8A21BC",
   "--purple-70": "#651B8B",
   "--purple-80": "#41125A",
   "--purple-90": "#260937",

   /* pink */
   "--pink-05": "#FDE6FC",
   "--pink-10": "#F9C5F6",
   "--pink-20": "#F39DEC",
   "--pink-30": "#EB74DF",
   "--pink-40": "#E049CE",
   "--pink-50": "#D41DBC",
   "--pink-60": "#9F1C8D",
   "--pink-70": "#751868",
   "--pink-80": "#4C0F43",
   "--pink-90": "#2E0728",
}

const iconColors = {
  default: {
    color: "--gray-90",
    twoColor: "--gray-90, --gray-30",
    threeColor: "--gray-90, --gray-30, --gray-0"
  },
  info: {
    color: "--blue-50",
    twoColor: "--blue-50, --blue-30",
    threeColor: "--blue-50, --blue-30, --blue-05"
  },
  error: {
    color: "--red-50",
    twoColor: "--red-50, --red-30",
    threeColor: "--red-50, --red-30, --red-05"
  },
  alert: {
    color: "--orange-50",
    twoColor: "--orange-50, --orange-30",
    threeColor: "--orange-50, --orange-30, --orange-05"
  },
  warning: {
    color: "--yellow-50",
    twoColor: "--yellow-50, --yellow-30",
    threeColor: "--yellow-50, --yellow-30, --yellow-05"
  },
  success: {
    color: "--mint-50",
    twoColor: "--mint-50, --mint-30",
    threeColor: "--mint-50, --mint-30, --mint-05"
  },
  disabled: {
    color: "--gray-30",
    twoColor: "--gray-30, --gray-50",
    threeColor: "--gray-30, --gray-50, --gray-0"
  },
  brand: {
    color: "--brand-50",
    twoColor: "--brand-50, --brand-30",
    threeColor: "--brand-50, --brand-30, --brand-05"
  },
  rose: {
    color: "--rose-50",
    twoColor: "--rose-50, --rose-30",
    threeColor: "--rose-50, --rose-30, --rose-05"
  },
  pink: {
    color: "--pink-50",
    twoColor: "--pink-50, --pink-30",
    threeColor: "--pink-50, --pink-30, --pink-05"
  },
  purple: {
    color: "--purple-50",
    twoColor: "--purple-50, --purple-30",
    threeColor: "--purple-50, --purple-30, --purple-05"
  },
  indigo: {
    color: "--indigo-50",
    twoColor: "--indigo-50, --indigo-30",
    threeColor: "--indigo-50, --indigo-30, --indigo-05"
  },
  cyan: {
    color: "--cyan-50",
    twoColor: "--cyan-50, --cyan-30",
    threeColor: "--cyan-50, --cyan-30, --cyan-05"
  },
  green: {
    color: "--green-50",
    twoColor: "--green-50, --green-30",
    threeColor: "--green-50, --green-30, --green-05"
  },
}

const tagColors = {
  default: {
    text: "--gray-70",
    bg: "--gray-90",
    bgOpacity: 0.05
  },
  info: {
    text: "--gray-0",
    bg: "--blue-50"
  },
  error: {
    text: "--gray-0",
    bg: "--red-50"
  },
  alert: {
    text: "--gray-0",
    bg: "--orange-50"
  },
  warning: {
    text: "--gray-0",
    bg: "--yellow-50"
  },
  success: {
    text: "--gray-0",
    bg: "--mint-50"
  },
  disabled: {
    text: "--gray-0",
    bg: "--gray-30"
  },
  brand: {
    text: "--brand-60",
    bg: "--brand-05"
  },
  rose: {
    text: "--rose-60",
    bg: "--rose-05"
  },
  pink: {
    text: "--pink-60",
    bg: "--pink-05"
  },
  purple: {
    text: "--purple-60",
    bg: "--purple-10",
    bgOpacity: 0.6
  },
  indigo: {
    text: "--indigo-80",
    bg: "--indigo-10",
    bgOpacity: 0.6
  },
  cyan: {
    text: "--cyan-80",
    bg: "--cyan-60",
    bgOpacity: 0.15
  },
  green: {
    text: "--mint-70",
    bg: "--green-10"
  },
}


export {
  themeColors,
  iconColors,
  tagColors
}