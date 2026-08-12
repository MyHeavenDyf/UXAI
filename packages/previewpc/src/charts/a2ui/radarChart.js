export default {
  padding: [20, 0, 10, 0],
  theme: 'cloud-light',
  adaptive:true,
  legend:{
    show: false
  },
  radar:{
    axisName: {
      formatter: (val) => {
          return val.length > 4 ? val.slice(0, 4) + '...' : val;
      }
    },
    axisNameGap:12
  }
}