// IST-safe date helpers. The server may run in UTC (Railway), but the business
// day is Asia/Kolkata — using toISOString() shifts records to the previous day
// between midnight and 05:30 IST.
const TZ = 'Asia/Kolkata';

// YYYY-MM-DD for "today" in IST ('sv-SE' locale formats as ISO date)
const istToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });

// YYYY-MM-DD in IST for an arbitrary Date
const istDateStr = (d) => d.toLocaleDateString('sv-SE', { timeZone: TZ });

// Minutes since midnight (0–1439) for "now" in IST. TZ-safe wall-clock value —
// use this instead of Date.setHours() (which is server-local, i.e. UTC on Railway)
// whenever comparing against an "HH:MM" shift time.
const istNowMinutes = () => {
  const hm = new Date().toLocaleTimeString('en-GB', {
    timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit',
  }); // "HH:MM" (00:00–23:59)
  const [h, m] = hm.split(':').map(Number);
  return (h % 24) * 60 + m;
};

module.exports = { istToday, istDateStr, istNowMinutes, TZ };
