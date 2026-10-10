/** `GET …/sender`: a connected club Gmail (or none), owned by Daly. */
export function senderFixture(connected = true) {
  return {
    sender: connected
      ? {
          connectionId: "3f1c2b8e-6a43-4f0e-9a51-1f2c3d4e5f60",
          email: "club@gmail.com",
          status: "active",
          connectedBy: "Daly",
          connectedAt: "2026-10-07T10:00:00Z",
          isMine: true,
          sentLast24h: 12,
          dailyLimit: 400,
        }
      : null,
    ownerName: "Daly",
    myConnections: [],
  };
}
