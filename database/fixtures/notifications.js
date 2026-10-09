// database/fixtures/notifications.js
// Four notification rows for the one route that reads the table (GET and PUT /api/admin/notifications, ENG-022), so a test of
// "only the signed-in admin's own rows" has rows that are not the admin's to leave out. Plain data with no imports. The
// identity rules in accounts.js bind this set too: the text is invented and names no one, and every timestamp is a fixed
// time, so two loads write the same bytes. Every row is unread.
//
// The admin is users id 3 (accounts.js). The route lists WHERE user_id = <the caller's id> AND user_type = 'admin':
//
//   notification 1, 2  user_id 3  user_type 'admin'     the admin's own rows; the route lists them newest first (2, then 1)
//   notification 3     user_id 1  user_type 'admin'     an admin-type row of another owner: only the user_id clause keeps it out
//   notification 4     user_id 3  user_type 'customer'  the admin's id with another kind of owner: only the user_type clause
//                                                       keeps it out
//
// Nothing else reads this table, so no other route's answer changes. The notifications table has no foreign key, and the
// rows name users 1 and 3 only because those ids exist. A PUT marks a row read and no route marks one unread: the cases that
// mark the admin's rows read leave them read, and the fixture command (npm run db:fixtures) puts them back.
//
// Order: this set needs nothing, so it is listed after accounts only to keep the user ids it names in view.

const FIXED_AT = '2026-01-01 00:00:00';
const LATER_AT = '2026-01-01 00:01:00';

const notification = ({ id, userId, userType, title, createdAt }) => ({
  id,
  user_id: userId,
  user_type: userType,
  type: 'system',
  title,
  message: `Fixture notification ${id}: ${title}`,
  data: null,
  is_read: 0,
  created_at: createdAt,
});

export const notifications = {
  name: 'notifications',
  tables: {
    notifications: [
      notification({ id: 1, userId: 3, userType: 'admin', title: 'Admin fixture, first', createdAt: FIXED_AT }),
      notification({ id: 2, userId: 3, userType: 'admin', title: 'Admin fixture, second', createdAt: LATER_AT }),
      notification({ id: 3, userId: 1, userType: 'admin', title: 'Another admin-type owner', createdAt: FIXED_AT }),
      notification({ id: 4, userId: 3, userType: 'customer', title: 'Customer-type owner on the admin id', createdAt: FIXED_AT }),
    ],
  },
};
