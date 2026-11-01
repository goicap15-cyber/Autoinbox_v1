process.env.CRM_DATA_ROOT = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/tmp/repro/data';
const svc = require('C:/Users/Admin/Downloads/Duan/CRM_FB1/src/server/services/CommentLeadsService.js');
try {
  const result = svc.enqueue({
    postUrl: 'https://www.facebook.com/share/p/1BhXnZBhbf/',
    accountId: '100066325187762',
    content: 'Chào {ten}! Test repro.'
  });
  console.log('ENQUEUE_OK', JSON.stringify(result));
} catch (err) {
  console.log('ENQUEUE_ERR:', err.message);
  console.log(err.stack);
}
