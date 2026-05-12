CREATE TABLE `account` (
	`userId` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`providerAccountId` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` integer,
	`token_type` text,
	`scope` text,
	`id_token` text,
	`session_state` text,
	PRIMARY KEY(`provider`, `providerAccountId`),
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ante_history` (
	`id` text PRIMARY KEY NOT NULL,
	`matchId` text NOT NULL,
	`gameNumber` integer NOT NULL,
	`winnerUserId` text NOT NULL,
	`loserUserId` text NOT NULL,
	`cardName` text NOT NULL,
	`setCode` text,
	`collectorNumber` text,
	`resolvedAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`winnerUserId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`loserUserId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ante_winner_idx` ON `ante_history` (`winnerUserId`);--> statement-breakpoint
CREATE INDEX `ante_loser_idx` ON `ante_history` (`loserUserId`);--> statement-breakpoint
CREATE TABLE `deck_card` (
	`id` text PRIMARY KEY NOT NULL,
	`deckId` text NOT NULL,
	`cardName` text NOT NULL,
	`setCode` text,
	`collectorNumber` text,
	`signedByDisplayName` text,
	`signedByUserId` text,
	`signedAt` integer,
	`addedAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`deckId`) REFERENCES `deck`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`signedByUserId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `deck_card_deck_idx` ON `deck_card` (`deckId`);--> statement-breakpoint
CREATE TABLE `deck` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`name` text NOT NULL,
	`format` text DEFAULT 'highlander' NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deck_user_idx` ON `deck` (`userId`);--> statement-breakpoint
CREATE TABLE `session` (
	`sessionToken` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text,
	`emailVerified` integer,
	`image` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verificationToken` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL,
	PRIMARY KEY(`identifier`, `token`)
);
