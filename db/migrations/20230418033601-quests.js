module.exports = {
  async up(db, client) {
    await db.createCollection('quests');

  },

  async down(db, client) {
    await db.collection('quests').drop();
  }
};