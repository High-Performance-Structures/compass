CREATE TABLE `user_desk_photos` (
	`user_id` text PRIMARY KEY NOT NULL,
	`mime_type` text,
	`image_data_base64` text,
	`hidden` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
