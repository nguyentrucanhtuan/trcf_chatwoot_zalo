-- Chỉ chạy khi volume postgres được khởi tạo lần đầu.
-- Mỗi service bridge một database riêng, không ghi vào database của Chatwoot.
CREATE DATABASE zalo_personal;
CREATE DATABASE zalo_oa;
