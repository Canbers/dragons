module.exports = {
  async up(db, client) {
    await db.createCollection('ecosystems');

  },

  async down(db, client) {
    await db.collection('ecosystems').drop();
  }
};
